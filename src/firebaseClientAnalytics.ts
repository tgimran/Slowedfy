import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const OperationType = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LIST: "list",
  GET: "get",
  WRITE: "write",
} as const;
type OperationType = (typeof OperationType)[keyof typeof OperationType];

interface FirestoreErrorInfo {
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

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const app = initializeApp(firebaseConfig);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

const ACTIVE_TIMEOUT_MS = 45 * 1000;
const SESSION_WRITE_THROTTLE_MS = 15 * 1000;

let connectionTested = false;
let visitorRegistered = false;
let sessionRegistered = false;
let lastSessionWriteMs = 0;

let cachedTotalVisitors: number | null = null;
let cachedActiveUsers: number | null = null;
const activeSessionVisitors = new Map<string, { visitorId: string; expiresAtMs: number }>();

let metaUnsub: Unsubscribe | null = null;
let sessionsUnsub: Unsubscribe | null = null;

function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(id.trim());
}

async function testConnection(): Promise<void> {
  if (connectionTested) return;
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
      throw error;
    }
  }
  connectionTested = true;
}

function computeActiveUsers(): number {
  const now = Date.now();
  const unique = new Set<string>();
  for (const [sid, rec] of activeSessionVisitors.entries()) {
    if (rec.expiresAtMs > now) {
      unique.add(rec.visitorId);
    } else {
      activeSessionVisitors.delete(sid);
    }
  }
  return unique.size;
}

type UpdateCallback = (stats: {
  websiteVisitors: number;
  activeUsers: number;
  verified: boolean;
}) => void;

type ErrorCallback = () => void;

const listeners = new Set<UpdateCallback>();

function emitCurrentStats(): void {
  if (cachedTotalVisitors === null) return;
  const active = cachedActiveUsers ?? computeActiveUsers();
  for (const cb of listeners) {
    try {
      cb({
        websiteVisitors: cachedTotalVisitors,
        activeUsers: active,
        verified: true,
      });
    } catch {
      // ignore listener errors
    }
  }
}

function ensureListeners(onError?: ErrorCallback): void {
  if (!metaUnsub) {
    const metaRef = doc(db, "analytics_meta", "global");
    metaUnsub = onSnapshot(
      metaRef,
      (snap) => {
        if (snap.exists()) {
          const val = snap.data()?.totalUniqueVisitors;
          if (typeof val === "number" && Number.isFinite(val)) {
            cachedTotalVisitors = val;
            emitCurrentStats();
          }
        }
      },
      (error) => {
        metaUnsub?.();
        metaUnsub = null;
        try {
          handleFirestoreError(error, OperationType.GET, "analytics_meta/global");
        } catch {
          onError?.();
        }
      }
    );
  }

  if (!sessionsUnsub) {
    const sessionsQ = query(
      collection(db, "analytics_sessions"),
      where("expiresAtMs", ">", 0)
    );
    sessionsUnsub = onSnapshot(
      sessionsQ,
      (snapshot) => {
        const now = Date.now();
        activeSessionVisitors.clear();
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const sid = typeof data?.sessionId === "string" ? data.sessionId : docSnap.id;
          const vid = typeof data?.visitorId === "string" ? data.visitorId : "";
          const expiresAtMs = typeof data?.expiresAtMs === "number" ? data.expiresAtMs : 0;
          if (isValidId(sid) && isValidId(vid) && expiresAtMs > now) {
            activeSessionVisitors.set(sid, { visitorId: vid, expiresAtMs });
          }
        }
        cachedActiveUsers = computeActiveUsers();
        emitCurrentStats();
      },
      (error) => {
        sessionsUnsub?.();
        sessionsUnsub = null;
        try {
          handleFirestoreError(error, OperationType.LIST, "analytics_sessions");
        } catch {
          // non-fatal for active sessions listener
        }
      }
    );
  }
}

async function syncDirect(
  visitorId: string,
  sessionId: string,
  onUpdate: UpdateCallback,
  onError?: ErrorCallback
): Promise<{ websiteVisitors: number; activeUsers: number; verified: boolean }> {
  listeners.add(onUpdate);
  const cleanVid = isValidId(visitorId) ? visitorId.trim() : "";
  const cleanSid = isValidId(sessionId) ? sessionId.trim() : "";

  await testConnection();
  ensureListeners(onError);

  if (cleanVid && !visitorRegistered) {
    const visitorRef = doc(db, "analytics_visitors", cleanVid);
    const metaRef = doc(db, "analytics_meta", "global");
    try {
      await runTransaction(db, async (tx) => {
        const [vSnap, mSnap] = await Promise.all([tx.get(visitorRef), tx.get(metaRef)]);
        if (!vSnap.exists()) {
          tx.set(visitorRef, {
            visitorId: cleanVid,
            firstSeen: serverTimestamp(),
            lastSeen: serverTimestamp(),
            visitCount: 1,
          });
          if (!mSnap.exists()) {
            tx.set(metaRef, {
              totalUniqueVisitors: 1,
              updatedAt: serverTimestamp(),
            });
            cachedTotalVisitors = 1;
          } else {
            const cur =
              typeof mSnap.data()?.totalUniqueVisitors === "number"
                ? mSnap.data().totalUniqueVisitors
                : 0;
            const next = cur + 1;
            tx.update(metaRef, {
              totalUniqueVisitors: next,
              updatedAt: serverTimestamp(),
            });
            cachedTotalVisitors = next;
          }
        } else {
          const prevVisits =
            typeof vSnap.data()?.visitCount === "number" && vSnap.data().visitCount >= 1
              ? vSnap.data().visitCount
              : 1;
          tx.update(visitorRef, {
            lastSeen: serverTimestamp(),
            visitCount: prevVisits + 1,
          });
          if (mSnap.exists()) {
            const total = mSnap.data()?.totalUniqueVisitors;
            if (typeof total === "number" && Number.isFinite(total)) {
              cachedTotalVisitors = total;
            }
          }
        }
      });
      visitorRegistered = true;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `analytics_visitors/${cleanVid}`);
    }
  } else if (cachedTotalVisitors === null) {
    try {
      const metaSnap = await getDocFromServer(doc(db, "analytics_meta", "global"));
      if (metaSnap.exists()) {
        const val = metaSnap.data()?.totalUniqueVisitors;
        if (typeof val === "number" && Number.isFinite(val)) {
          cachedTotalVisitors = val;
        }
      } else {
        cachedTotalVisitors = 0;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, "analytics_meta/global");
    }
  }

  const now = Date.now();
  if (cleanSid && cleanVid && (!sessionRegistered || now - lastSessionWriteMs >= SESSION_WRITE_THROTTLE_MS)) {
    const expiresAtMs = now + ACTIVE_TIMEOUT_MS;
    const sessRef = doc(db, "analytics_sessions", cleanSid);
    lastSessionWriteMs = now;
    try {
      if (sessionRegistered) {
        try {
          await updateDoc(sessRef, {
            lastSeen: serverTimestamp(),
            expiresAtMs,
          });
        } catch (err: any) {
          if (err?.code !== "not-found") throw err;
          sessionRegistered = false;
        }
      }
      if (!sessionRegistered) {
        await setDoc(sessRef, {
          sessionId: cleanSid,
          visitorId: cleanVid,
          lastSeen: serverTimestamp(),
          expiresAtMs,
        });
        sessionRegistered = true;
      }
      activeSessionVisitors.set(cleanSid, { visitorId: cleanVid, expiresAtMs });
    } catch (error) {
      lastSessionWriteMs = 0;
      handleFirestoreError(error, OperationType.WRITE, `analytics_sessions/${cleanSid}`);
    }
  }

  const totalVisitors = cachedTotalVisitors ?? 0;
  const activeUsers = computeActiveUsers();
  cachedActiveUsers = activeUsers;

  const result = {
    websiteVisitors: totalVisitors,
    activeUsers,
    verified: true,
  };
  onUpdate(result);
  return result;
}

function subscribeRealtimeOnly(onUpdate: UpdateCallback, onError?: ErrorCallback): void {
  listeners.add(onUpdate);
  testConnection()
    .then(() => {
      ensureListeners(onError);
    })
    .catch(() => {});
}

async function leaveSessionDirect(sessionId: string): Promise<void> {
  if (!isValidId(sessionId)) return;
  const cleanSid = sessionId.trim();
  activeSessionVisitors.delete(cleanSid);
  sessionRegistered = false;
  try {
    await deleteDoc(doc(db, "analytics_sessions", cleanSid));
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.DELETE, `analytics_sessions/${cleanSid}`);
    } catch {
      // ignore on unload
    }
  }
}

declare global {
  interface Window {
    FirebaseClientAnalytics?: {
      syncDirect: typeof syncDirect;
      subscribeRealtimeOnly: typeof subscribeRealtimeOnly;
      leaveSessionDirect: typeof leaveSessionDirect;
    };
  }
}

if (typeof window !== "undefined") {
  window.FirebaseClientAnalytics = {
    syncDirect,
    subscribeRealtimeOnly,
    leaveSessionDirect,
  };
}
