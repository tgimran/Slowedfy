/**
 * Slowedfy Analytics Store (Cloud Firestore Backed)
 * Permanent persistent database for:
 * 1. Accurate Total Unique Website Visitors (all-time permanent count in Firestore; never resets monthly or on restarts/deployments; zero refresh inflation)
 * 2. Real-Time Active Users (Firestore session heartbeats + SSE presence tracking with automatic inactive expiry)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

export const OperationType = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LIST: "list",
  GET: "get",
  WRITE: "write",
} as const;
export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

interface FirebaseAppletConfig extends FirebaseOptions {
  firestoreDatabaseId?: string;
}

export interface AnalyticsStatsResult {
  websiteVisitors: number | null;
  activeUsers: number | null;
  verified: boolean;
  loading?: boolean;
  unavailable?: boolean;
  updatedAt: number;
}

interface ActiveSession {
  visitorId: string;
  lastSeen: number;
  expiresAtMs: number;
  hasSse: boolean;
}

const DATA_DIR = path.join(process.cwd(), "data");
const LEGACY_DB_FILE = path.join(DATA_DIR, "analytics.json");

function resolveConfigFilePath(): string {
  const cwdCandidate = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  try {
    const relativeCandidate = fileURLToPath(new URL("../firebase-applet-config.json", import.meta.url));
    if (fs.existsSync(relativeCandidate)) return relativeCandidate;
  } catch {
    // ignore
  }
  return cwdCandidate;
}

// 45 seconds without heartbeat or active SSE ping = session expired
const ACTIVE_TIMEOUT_MS = 45 * 1000;
// 3 seconds grace after SSE disconnect before expiring session (handles instant page refreshes smoothly)
const SSE_DISCONNECT_GRACE_MS = 3 * 1000;
// Minimum interval between Firestore writes for an already-registered active session
const SESSION_WRITE_THROTTLE_MS = 15 * 1000;
// Minimum cooldown before retrying failed Firestore initialization
const INIT_RETRY_COOLDOWN_MS = 2000;

let db: Firestore | null = null;
let firestoreReady = false;
let firestoreUnavailable = false;
let lastInitFailureMs = 0;
let initPromise: Promise<boolean> | null = null;

let totalUniqueVisitorsCache: number | null = null;
const knownVisitorIds = new Set<string>();
const pendingVisitorRegistrations = new Map<string, Promise<boolean>>();

// Active presence sessions synchronized with Firestore `analytics_sessions`
const activeSessions = new Map<string, ActiveSession>();
const lastSessionWriteTime = new Map<string, number>();
const sessionExistsInFirestore = new Set<string>();
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

let metaUnsubscribe: Unsubscribe | null = null;
let sessionsUnsubscribe: Unsubscribe | null = null;
let lastBroadcastActiveCount = -1;
let lastBroadcastVisitorsCount = -1;
let changeListener: (() => void) | null = null;

export function registerAnalyticsChangeListener(fn: () => void): void {
  changeListener = fn;
}

function notifyAnalyticsChange(): void {
  if (changeListener) {
    try {
      changeListener();
    } catch {
      // ignore listener errors
    }
  }
}

export function isValidAnalyticsId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(id.trim());
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  docPath: string | null
): never {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: [],
    },
    operationType,
    path: docPath,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function initFirebaseClient(): Firestore {
  if (db) return db;
  const configPath = resolveConfigFilePath();
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing firebase-applet-config.json");
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const firebaseConfig = JSON.parse(raw) as FirebaseAppletConfig;
  const app = initializeApp(firebaseConfig);
  db = firebaseConfig.firestoreDatabaseId
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
  return db;
}

async function testConnection(firestore: Firestore): Promise<void> {
  try {
    await getDocFromServer(doc(firestore, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("[Analytics] Please check your Firebase configuration (client is offline).");
      throw error;
    }
    // Note: permission-denied on /test/connection confirms live server reachability
  }

  // Also verify real read access on analytics_meta/global directly from server
  try {
    await getDocFromServer(doc(firestore, "analytics_meta", "global"));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, "analytics_meta/global");
  }
}

function readLegacyVisitorIds(): string[] {
  try {
    if (!fs.existsSync(LEGACY_DB_FILE)) return [];
    const raw = fs.readFileSync(LEGACY_DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const ids = new Set<string>();
    if (parsed?.visitors && typeof parsed.visitors === "object") {
      for (const vid of Object.keys(parsed.visitors)) {
        if (isValidAnalyticsId(vid)) ids.add(vid.trim());
      }
    }
    if (parsed?.months && typeof parsed.months === "object") {
      for (const m of Object.values(parsed.months) as any[]) {
        if (m?.visitors && typeof m.visitors === "object") {
          for (const vid of Object.keys(m.visitors)) {
            if (isValidAnalyticsId(vid)) ids.add(vid.trim());
          }
        }
      }
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

async function ensureMetaAndMigrateLegacy(firestore: Firestore): Promise<void> {
  const metaRef = doc(firestore, "analytics_meta", "global");
  const legacyIds = readLegacyVisitorIds();

  // First ensure every legacy visitor (if any) is safely migrated once without double-counting
  for (const vid of legacyIds) {
    try {
      const existingSnap = await getDoc(doc(firestore, "analytics_visitors", vid));
      if (existingSnap.exists()) {
        knownVisitorIds.add(vid);
      } else {
        await registerVisitorInFirestore(firestore, vid);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `analytics_visitors/${vid}`);
    }
  }

  // Ensure analytics_meta/global exists even if there are 0 visitors yet
  try {
    await runTransaction(firestore, async (tx) => {
      const metaSnap = await tx.get(metaRef);
      if (!metaSnap.exists()) {
        tx.set(metaRef, {
          totalUniqueVisitors: 0,
          updatedAt: serverTimestamp(),
        });
        totalUniqueVisitorsCache = 0;
      } else {
        const data = metaSnap.data();
        if (typeof data?.totalUniqueVisitors === "number" && Number.isFinite(data.totalUniqueVisitors)) {
          totalUniqueVisitorsCache = data.totalUniqueVisitors;
        }
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "analytics_meta/global");
  }
}

function attachRealtimeListeners(firestore: Firestore): void {
  if (!metaUnsubscribe) {
    const metaRef = doc(firestore, "analytics_meta", "global");
    metaUnsubscribe = onSnapshot(
      metaRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (typeof data?.totalUniqueVisitors === "number" && Number.isFinite(data.totalUniqueVisitors)) {
            const changed = totalUniqueVisitorsCache !== data.totalUniqueVisitors;
            totalUniqueVisitorsCache = data.totalUniqueVisitors;
            firestoreReady = true;
            firestoreUnavailable = false;
            if (changed) {
              lastBroadcastVisitorsCount = data.totalUniqueVisitors;
              notifyAnalyticsChange();
            }
          }
        }
      },
      (error) => {
        firestoreUnavailable = true;
        try {
          handleFirestoreError(error, OperationType.GET, "analytics_meta/global");
        } catch {
          notifyAnalyticsChange();
        }
      }
    );
  }

  if (!sessionsUnsubscribe) {
    const sessionsQuery = query(
      collection(firestore, "analytics_sessions"),
      where("expiresAtMs", ">", 0)
    );
    sessionsUnsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const now = Date.now();
        const prevActiveCount = getActiveUniqueUsersCount();
        const seenRemoteIds = new Set<string>();

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const sid = typeof data?.sessionId === "string" ? data.sessionId.trim() : docSnap.id;
          const vid = typeof data?.visitorId === "string" ? data.visitorId.trim() : "";
          const expiresAtMs = typeof data?.expiresAtMs === "number" ? data.expiresAtMs : 0;

          if (!isValidAnalyticsId(sid) || !isValidAnalyticsId(vid)) continue;
          sessionExistsInFirestore.add(sid);
          seenRemoteIds.add(sid);

          if (expiresAtMs > now) {
            const existing = activeSessions.get(sid);
            activeSessions.set(sid, {
              visitorId: vid,
              lastSeen: Math.max(existing?.lastSeen ?? 0, expiresAtMs - ACTIVE_TIMEOUT_MS),
              expiresAtMs: Math.max(existing?.expiresAtMs ?? 0, expiresAtMs),
              hasSse: existing?.hasSse ?? false,
            });
          } else {
            activeSessions.delete(sid);
            // Opportunistically clean up expired remote sessions
            if (now - expiresAtMs > 5000) {
              deleteDoc(doc(firestore, "analytics_sessions", sid)).catch(() => {});
            }
          }
        }

        // Remove sessions deleted remotely (e.g., from another instance) unless written locally < 4s ago
        for (const [sid] of activeSessions.entries()) {
          if (!seenRemoteIds.has(sid)) {
            const lastLocalWrite = lastSessionWriteTime.get(sid) ?? 0;
            if (now - lastLocalWrite > 4000) {
              activeSessions.delete(sid);
              sessionExistsInFirestore.delete(sid);
            }
          }
        }

        const nextActiveCount = getActiveUniqueUsersCount();
        if (nextActiveCount !== prevActiveCount) {
          lastBroadcastActiveCount = nextActiveCount;
          notifyAnalyticsChange();
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, "analytics_sessions");
        } catch {
          // non-fatal for listener
        }
      }
    );
  }
}

async function performInitialSync(): Promise<boolean> {
  try {
    const firestore = initFirebaseClient();
    await testConnection(firestore);
    await ensureMetaAndMigrateLegacy(firestore);

    // Seed initial active sessions from Firestore immediately before starting listeners
    try {
      const now = Date.now();
      const q = query(collection(firestore, "analytics_sessions"), where("expiresAtMs", ">", 0));
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const sid = typeof data?.sessionId === "string" ? data.sessionId.trim() : docSnap.id;
        const vid = typeof data?.visitorId === "string" ? data.visitorId.trim() : "";
        const expiresAtMs = typeof data?.expiresAtMs === "number" ? data.expiresAtMs : 0;
        if (!isValidAnalyticsId(sid) || !isValidAnalyticsId(vid)) continue;
        sessionExistsInFirestore.add(sid);
        if (expiresAtMs > now) {
          activeSessions.set(sid, {
            visitorId: vid,
            lastSeen: expiresAtMs - ACTIVE_TIMEOUT_MS,
            expiresAtMs,
            hasSse: false,
          });
        } else if (now - expiresAtMs > 5000) {
          deleteDoc(doc(firestore, "analytics_sessions", sid)).catch(() => {});
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "analytics_sessions");
    }

    attachRealtimeListeners(firestore);
    firestoreReady = true;
    firestoreUnavailable = false;
    lastInitFailureMs = 0;
    notifyAnalyticsChange();
    return true;
  } catch (err) {
    console.error("[Analytics] Failed to initialize Firestore analytics store:", err);
    firestoreReady = false;
    firestoreUnavailable = true;
    lastInitFailureMs = Date.now();
    initPromise = null; // allow recovery attempt on subsequent requests
    notifyAnalyticsChange();
    return false;
  }
}

export async function ensureAnalyticsReady(): Promise<boolean> {
  if (firestoreReady && !firestoreUnavailable && db && totalUniqueVisitorsCache !== null) {
    return true;
  }
  if (initPromise) {
    return initPromise;
  }
  if (firestoreUnavailable && Date.now() - lastInitFailureMs < INIT_RETRY_COOLDOWN_MS) {
    return false;
  }
  initPromise = performInitialSync();
  return initPromise;
}

async function registerVisitorInFirestore(
  firestore: Firestore,
  cleanVid: string
): Promise<boolean> {
  if (knownVisitorIds.has(cleanVid)) {
    return false;
  }

  const inflight = pendingVisitorRegistrations.get(cleanVid);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    const visitorRef = doc(firestore, "analytics_visitors", cleanVid);
    const metaRef = doc(firestore, "analytics_meta", "global");
    let isNewVisitor = false;

    try {
      await runTransaction(firestore, async (tx) => {
        const [visitorSnap, metaSnap] = await Promise.all([
          tx.get(visitorRef),
          tx.get(metaRef),
        ]);

        if (!visitorSnap.exists()) {
          tx.set(visitorRef, {
            visitorId: cleanVid,
            firstSeen: serverTimestamp(),
            lastSeen: serverTimestamp(),
            visitCount: 1,
          });

          if (!metaSnap.exists()) {
            tx.set(metaRef, {
              totalUniqueVisitors: 1,
              updatedAt: serverTimestamp(),
            });
            totalUniqueVisitorsCache = 1;
          } else {
            const currentTotal =
              typeof metaSnap.data()?.totalUniqueVisitors === "number"
                ? metaSnap.data().totalUniqueVisitors
                : 0;
            const nextTotal = currentTotal + 1;
            tx.update(metaRef, {
              totalUniqueVisitors: nextTotal,
              updatedAt: serverTimestamp(),
            });
            totalUniqueVisitorsCache = nextTotal;
          }
          isNewVisitor = true;
        } else {
          const existingData = visitorSnap.data();
          const currentVisits =
            typeof existingData?.visitCount === "number" && existingData.visitCount >= 1
              ? existingData.visitCount
              : 1;
          tx.update(visitorRef, {
            lastSeen: serverTimestamp(),
            visitCount: currentVisits + 1,
          });
          if (metaSnap.exists()) {
            const total = metaSnap.data()?.totalUniqueVisitors;
            if (typeof total === "number" && Number.isFinite(total)) {
              totalUniqueVisitorsCache = total;
            }
          }
          isNewVisitor = false;
        }
      });

      knownVisitorIds.add(cleanVid);
      return isNewVisitor;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `analytics_visitors/${cleanVid}`);
    } finally {
      pendingVisitorRegistrations.delete(cleanVid);
    }
  })();

  pendingVisitorRegistrations.set(cleanVid, task);
  return task;
}

async function upsertSessionInFirestore(
  firestore: Firestore,
  cleanSid: string,
  cleanVid: string,
  expiresAtMs: number
): Promise<void> {
  const now = Date.now();
  const lastWrite = lastSessionWriteTime.get(cleanSid) ?? 0;
  if (now - lastWrite < SESSION_WRITE_THROTTLE_MS && sessionExistsInFirestore.has(cleanSid)) {
    return;
  }

  lastSessionWriteTime.set(cleanSid, now);
  const sessionRef = doc(firestore, "analytics_sessions", cleanSid);

  try {
    if (sessionExistsInFirestore.has(cleanSid)) {
      try {
        await updateDoc(sessionRef, {
          lastSeen: serverTimestamp(),
          expiresAtMs,
        });
        return;
      } catch (err: any) {
        // Document might have been cleaned up externally; fall through to create
        if (err?.code !== "not-found") {
          throw err;
        }
        sessionExistsInFirestore.delete(cleanSid);
      }
    }

    await setDoc(sessionRef, {
      sessionId: cleanSid,
      visitorId: cleanVid,
      lastSeen: serverTimestamp(),
      expiresAtMs,
    });
    sessionExistsInFirestore.add(cleanSid);
  } catch (error) {
    lastSessionWriteTime.delete(cleanSid);
    handleFirestoreError(error, OperationType.WRITE, `analytics_sessions/${cleanSid}`);
  }
}

async function deleteSessionInFirestore(
  firestore: Firestore,
  cleanSid: string
): Promise<void> {
  const sessionRef = doc(firestore, "analytics_sessions", cleanSid);
  sessionExistsInFirestore.delete(cleanSid);
  lastSessionWriteTime.delete(cleanSid);
  try {
    await deleteDoc(sessionRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `analytics_sessions/${cleanSid}`);
  }
}

export function getActiveUniqueUsersCount(): number {
  const now = Date.now();
  const uniqueVisitors = new Set<string>();
  for (const [sid, sess] of activeSessions.entries()) {
    if (sess.expiresAtMs > now) {
      uniqueVisitors.add(sess.visitorId);
    } else {
      activeSessions.delete(sid);
    }
  }
  return uniqueVisitors.size;
}

export async function cleanExpiredSessions(): Promise<number> {
  const now = Date.now();
  const prevCount = getActiveUniqueUsersCount();
  const expiredIds: string[] = [];

  for (const [sid, sess] of activeSessions.entries()) {
    if (sess.expiresAtMs <= now) {
      activeSessions.delete(sid);
      expiredIds.push(sid);
      const pending = disconnectGraceTimers.get(sid);
      if (pending) {
        clearTimeout(pending);
        disconnectGraceTimers.delete(sid);
      }
    }
  }

  if (db && firestoreReady && expiredIds.length > 0) {
    for (const sid of expiredIds) {
      deleteSessionInFirestore(db, sid).catch(() => {});
    }
  }

  const nextCount = getActiveUniqueUsersCount();
  if (nextCount !== prevCount) {
    lastBroadcastActiveCount = nextCount;
    notifyAnalyticsChange();
  }
  return nextCount;
}

export async function recordHeartbeat(
  visitorId: string,
  sessionId: string
): Promise<{
  websiteVisitors: number | null;
  activeUsers: number | null;
  isNewVisitor: boolean;
  activeCountChanged: boolean;
  verified: boolean;
  unavailable?: boolean;
  updatedAt: number;
}> {
  const now = Date.now();
  const cleanVid = visitorId.trim();
  const cleanSid = sessionId.trim();

  const ready = await ensureAnalyticsReady();
  if (!ready || !db || totalUniqueVisitorsCache === null) {
    return {
      websiteVisitors: null,
      activeUsers: null,
      isNewVisitor: false,
      activeCountChanged: false,
      verified: false,
      unavailable: true,
      updatedAt: now,
    };
  }

  const prevActiveCount = getActiveUniqueUsersCount();

  try {
    const isNewVisitor = await registerVisitorInFirestore(db, cleanVid);

    if (isValidAnalyticsId(cleanSid)) {
      const pending = disconnectGraceTimers.get(cleanSid);
      if (pending) {
        clearTimeout(pending);
        disconnectGraceTimers.delete(cleanSid);
      }
      const existingSess = activeSessions.get(cleanSid);
      const expiresAtMs = now + ACTIVE_TIMEOUT_MS;
      activeSessions.set(cleanSid, {
        visitorId: cleanVid,
        lastSeen: now,
        expiresAtMs,
        hasSse: existingSess ? existingSess.hasSse : false,
      });

      await upsertSessionInFirestore(db, cleanSid, cleanVid, expiresAtMs);
    }

    // Sweep locally expired sessions
    for (const [sid, sess] of activeSessions.entries()) {
      if (sess.expiresAtMs <= now) {
        activeSessions.delete(sid);
        deleteSessionInFirestore(db, sid).catch(() => {});
      }
    }

    const activeUsers = getActiveUniqueUsersCount();
    const activeCountChanged = activeUsers !== prevActiveCount;
    lastBroadcastActiveCount = activeUsers;
    firestoreUnavailable = false;
    firestoreReady = true;

    return {
      websiteVisitors: totalUniqueVisitorsCache,
      activeUsers,
      isNewVisitor,
      activeCountChanged,
      verified: true,
      updatedAt: now,
    };
  } catch (err) {
    console.error("[Analytics] Heartbeat persistence error:", err);
    firestoreUnavailable = true;
    lastInitFailureMs = Date.now();
    initPromise = null;
    return {
      websiteVisitors: null,
      activeUsers: null,
      isNewVisitor: false,
      activeCountChanged: false,
      verified: false,
      unavailable: true,
      updatedAt: now,
    };
  }
}

export async function registerSseSession(
  sessionId: string,
  visitorId: string
): Promise<boolean> {
  if (!isValidAnalyticsId(sessionId) || !isValidAnalyticsId(visitorId)) {
    return false;
  }

  const ready = await ensureAnalyticsReady();
  if (!ready || !db) return false;

  const cleanSid = sessionId.trim();
  const cleanVid = visitorId.trim();
  const now = Date.now();
  const prevCount = getActiveUniqueUsersCount();

  const pending = disconnectGraceTimers.get(cleanSid);
  if (pending) {
    clearTimeout(pending);
    disconnectGraceTimers.delete(cleanSid);
  }

  const expiresAtMs = now + ACTIVE_TIMEOUT_MS;
  activeSessions.set(cleanSid, {
    visitorId: cleanVid,
    lastSeen: now,
    expiresAtMs,
    hasSse: true,
  });

  let visitorAdded = false;
  try {
    visitorAdded = await registerVisitorInFirestore(db, cleanVid);
    await upsertSessionInFirestore(db, cleanSid, cleanVid, expiresAtMs);
  } catch {
    return false;
  }

  const nextCount = getActiveUniqueUsersCount();
  lastBroadcastActiveCount = nextCount;
  return visitorAdded || nextCount !== prevCount;
}

export function touchSseSession(sessionId: string): void {
  if (!isValidAnalyticsId(sessionId)) return;
  const cleanSid = sessionId.trim();
  const sess = activeSessions.get(cleanSid);
  if (!sess) return;

  const now = Date.now();
  const expiresAtMs = now + ACTIVE_TIMEOUT_MS;
  sess.lastSeen = now;
  sess.expiresAtMs = expiresAtMs;
  sess.hasSse = true;

  // Keep Firestore presence fresh every 20s without spamming every 10s ping
  const lastWrite = lastSessionWriteTime.get(cleanSid) ?? 0;
  if (db && firestoreReady && now - lastWrite >= 20000) {
    upsertSessionInFirestore(db, cleanSid, sess.visitorId, expiresAtMs).catch(() => {});
  }
}

export function unregisterSseSession(sessionId: string): void {
  if (!isValidAnalyticsId(sessionId)) return;
  const cleanSid = sessionId.trim();
  const sess = activeSessions.get(cleanSid);
  if (!sess) return;
  sess.hasSse = false;

  if (disconnectGraceTimers.has(cleanSid)) return;

  const timer = setTimeout(() => {
    disconnectGraceTimers.delete(cleanSid);
    const current = activeSessions.get(cleanSid);
    if (current && !current.hasSse && Date.now() - current.lastSeen >= SSE_DISCONNECT_GRACE_MS - 100) {
      const prevCount = getActiveUniqueUsersCount();
      activeSessions.delete(cleanSid);
      if (db && firestoreReady) {
        deleteSessionInFirestore(db, cleanSid).catch(() => {});
      }
      const nextCount = getActiveUniqueUsersCount();
      if (nextCount !== prevCount) {
        lastBroadcastActiveCount = nextCount;
        notifyAnalyticsChange();
      }
    }
  }, SSE_DISCONNECT_GRACE_MS);

  disconnectGraceTimers.set(cleanSid, timer);
}

export async function recordSessionLeave(sessionId: string): Promise<{
  activeUsers: number | null;
  changed: boolean;
  verified: boolean;
}> {
  const cleanSid = sessionId.trim();
  const prevCount = getActiveUniqueUsersCount();

  const pending = disconnectGraceTimers.get(cleanSid);
  if (pending) {
    clearTimeout(pending);
    disconnectGraceTimers.delete(cleanSid);
  }

  if (cleanSid && activeSessions.has(cleanSid)) {
    activeSessions.delete(cleanSid);
  }

  if (cleanSid && isValidAnalyticsId(cleanSid) && db && firestoreReady) {
    await deleteSessionInFirestore(db, cleanSid).catch(() => {});
  }

  const now = Date.now();
  for (const [sid, sess] of activeSessions.entries()) {
    if (sess.expiresAtMs <= now) {
      activeSessions.delete(sid);
    }
  }

  if (!firestoreReady || firestoreUnavailable || totalUniqueVisitorsCache === null) {
    return { activeUsers: null, changed: false, verified: false };
  }

  const activeUsers = getActiveUniqueUsersCount();
  const changed = activeUsers !== prevCount;
  lastBroadcastActiveCount = activeUsers;

  return { activeUsers, changed, verified: true };
}

export async function getAnalyticsStats(): Promise<AnalyticsStatsResult> {
  const now = Date.now();
  await ensureAnalyticsReady();

  if (!firestoreReady || firestoreUnavailable || totalUniqueVisitorsCache === null) {
    return {
      websiteVisitors: null,
      activeUsers: null,
      verified: false,
      loading: !firestoreUnavailable && !firestoreReady,
      unavailable: firestoreUnavailable,
      updatedAt: now,
    };
  }

  for (const [sid, sess] of activeSessions.entries()) {
    if (sess.expiresAtMs <= now) {
      activeSessions.delete(sid);
    }
  }

  const activeUsers = getActiveUniqueUsersCount();
  lastBroadcastActiveCount = activeUsers;
  lastBroadcastVisitorsCount = totalUniqueVisitorsCache;

  return {
    websiteVisitors: totalUniqueVisitorsCache,
    activeUsers,
    verified: true,
    loading: false,
    unavailable: false,
    updatedAt: now,
  };
}

export function getCachedAnalyticsStatsSync(): AnalyticsStatsResult {
  const now = Date.now();
  if (!firestoreReady || firestoreUnavailable || totalUniqueVisitorsCache === null) {
    return {
      websiteVisitors: null,
      activeUsers: null,
      verified: false,
      loading: !firestoreUnavailable && !firestoreReady,
      unavailable: firestoreUnavailable,
      updatedAt: now,
    };
  }

  const activeUsers = getActiveUniqueUsersCount();
  return {
    websiteVisitors: totalUniqueVisitorsCache,
    activeUsers,
    verified: true,
    loading: false,
    unavailable: false,
    updatedAt: now,
  };
}

// Start Firestore connection and real-time sync on boot
initPromise = performInitialSync();

// Regular sweep for expired inactive sessions
const sweepTimer = setInterval(() => {
  cleanExpiredSessions().catch(() => {});
}, 10000);
sweepTimer.unref?.();

// Clean up Firestore listeners on process shutdown
function cleanupAnalyticsStore(): void {
  try {
    metaUnsubscribe?.();
    metaUnsubscribe = null;
    sessionsUnsubscribe?.();
    sessionsUnsubscribe = null;
  } catch {
    // ignore
  }
}

process.on("SIGINT", cleanupAnalyticsStore);
process.on("SIGTERM", cleanupAnalyticsStore);
