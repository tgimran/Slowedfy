/**
 * Slowedfy Analytics Store
 * Persistent database for:
 * 1. Accurate Total Unique Website Visitors (deduplicated by persistent visitor ID; zero refresh inflation)
 * 2. Real-Time Active Users (session/heartbeat + SSE presence tracking with automatic inactive expiry)
 */

import fs from "fs";
import path from "path";

export interface VisitorRecord {
  firstSeen: number;
  lastSeen: number;
  visitCount?: number;
}

export interface LegacyMonthlyRecord {
  visitors: Record<string, { firstSeen: number; lastSeen: number }>;
  count: number;
}

export interface AnalyticsDbSchema {
  visitors: Record<string, VisitorRecord>;
  totalUniqueVisitors: number;
}

interface ActiveSession {
  visitorId: string;
  lastSeen: number;
  hasSse: boolean;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "analytics.json");

// In-memory persistent store cache
let dbCache: AnalyticsDbSchema = {
  visitors: {},
  totalUniqueVisitors: 0,
};

// In-memory active presence sessions: sessionId -> ActiveSession
const activeSessions = new Map<string, ActiveSession>();
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

// 45 seconds without heartbeat or active SSE ping = session expired
const ACTIVE_TIMEOUT_MS = 45 * 1000;
// 3 seconds grace after SSE disconnect before expiring session (handles instant page refreshes smoothly)
const SSE_DISCONNECT_GRACE_MS = 3 * 1000;

let lastBroadcastActiveCount = 0;
let changeListener: (() => void) | null = null;

export function registerAnalyticsChangeListener(fn: () => void): void {
  changeListener = fn;
}

function notifyAnalyticsChange(): void {
  if (changeListener) {
    try {
      changeListener();
    } catch (e) {}
  }
}

export function isValidAnalyticsId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(id.trim());
}

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
      console.error("[Analytics] Error creating data directory:", err);
    }
  }
}

function cleanupStaleTempFiles(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    const files = fs.readdirSync(DATA_DIR);
    for (const f of files) {
      if (f.startsWith("analytics.json.tmp_")) {
        try {
          fs.unlinkSync(path.join(DATA_DIR, f));
        } catch (e) {}
      }
    }
  } catch (e) {}
}

function loadDatabase(): void {
  ensureDataDirectory();
  cleanupStaleTempFiles();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);

      const mergedVisitors: Record<string, VisitorRecord> = {};

      // Load current visitors map if present
      if (parsed && parsed.visitors && typeof parsed.visitors === "object") {
        for (const [vid, rec] of Object.entries(parsed.visitors)) {
          if (isValidAnalyticsId(vid) && rec && typeof rec === "object") {
            const r = rec as Partial<VisitorRecord>;
            mergedVisitors[vid] = {
              firstSeen: typeof r.firstSeen === "number" ? r.firstSeen : Date.now(),
              lastSeen: typeof r.lastSeen === "number" ? r.lastSeen : Date.now(),
              visitCount: typeof r.visitCount === "number" ? r.visitCount : 1,
            };
          }
        }
      }

      // Migrate any legacy monthly records into deduplicated all-time unique visitors map
      if (parsed && parsed.months && typeof parsed.months === "object") {
        for (const monthRec of Object.values(parsed.months)) {
          const m = monthRec as Partial<LegacyMonthlyRecord>;
          if (m && m.visitors && typeof m.visitors === "object") {
            for (const [vid, rec] of Object.entries(m.visitors)) {
              if (isValidAnalyticsId(vid) && rec && typeof rec === "object") {
                const existing = mergedVisitors[vid];
                const firstSeen = typeof rec.firstSeen === "number" ? rec.firstSeen : Date.now();
                const lastSeen = typeof rec.lastSeen === "number" ? rec.lastSeen : Date.now();
                if (!existing) {
                  mergedVisitors[vid] = { firstSeen, lastSeen, visitCount: 1 };
                } else {
                  existing.firstSeen = Math.min(existing.firstSeen, firstSeen);
                  existing.lastSeen = Math.max(existing.lastSeen, lastSeen);
                }
              }
            }
          }
        }
      }

      dbCache = {
        visitors: mergedVisitors,
        totalUniqueVisitors: Object.keys(mergedVisitors).length,
      };
      saveDatabaseSync();
      return;
    } catch (err) {
      console.warn("[Analytics] Corrupted analytics.json, initializing fresh store:", err);
    }
  }

  dbCache = {
    visitors: {},
    totalUniqueVisitors: 0,
  };
  saveDatabaseSync();
}

let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave(delayMs = 500): void {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    saveDatabaseSync();
  }, delayMs);
}

export function saveDatabaseSync(): void {
  ensureDataDirectory();
  try {
    dbCache.totalUniqueVisitors = Object.keys(dbCache.visitors).length;
    const tempFile = `${DB_FILE}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2), "utf-8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error("[Analytics] Error saving analytics database:", err);
  }
}

export function getActiveUniqueUsersCount(): number {
  const uniqueVisitors = new Set<string>();
  for (const sess of activeSessions.values()) {
    uniqueVisitors.add(sess.visitorId);
  }
  return uniqueVisitors.size;
}

export function cleanExpiredSessions(): number {
  const now = Date.now();
  const prevCount = getActiveUniqueUsersCount();

  for (const [sid, sess] of activeSessions.entries()) {
    if (now - sess.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeSessions.delete(sid);
      const pending = disconnectGraceTimers.get(sid);
      if (pending) {
        clearTimeout(pending);
        disconnectGraceTimers.delete(sid);
      }
    }
  }

  const nextCount = getActiveUniqueUsersCount();
  if (nextCount !== prevCount) {
    lastBroadcastActiveCount = nextCount;
    notifyAnalyticsChange();
  }
  return nextCount;
}

export function recordHeartbeat(
  visitorId: string,
  sessionId: string
): {
  websiteVisitors: number;
  activeUsers: number;
  isNewVisitor: boolean;
  activeCountChanged: boolean;
  updatedAt: number;
} {
  const now = Date.now();
  const cleanVid = visitorId.trim();
  const cleanSid = sessionId.trim();

  const prevActiveCount = getActiveUniqueUsersCount();

  let isNewVisitor = false;
  if (!dbCache.visitors[cleanVid]) {
    dbCache.visitors[cleanVid] = {
      firstSeen: now,
      lastSeen: now,
      visitCount: 1,
    };
    dbCache.totalUniqueVisitors = Object.keys(dbCache.visitors).length;
    isNewVisitor = true;
    // Persist immediately when a verified new unique visitor arrives
    saveDatabaseSync();
  } else {
    dbCache.visitors[cleanVid].lastSeen = now;
    scheduleSave(5000);
  }

  if (cleanSid && isValidAnalyticsId(cleanSid)) {
    const pending = disconnectGraceTimers.get(cleanSid);
    if (pending) {
      clearTimeout(pending);
      disconnectGraceTimers.delete(cleanSid);
    }
    const existingSess = activeSessions.get(cleanSid);
    activeSessions.set(cleanSid, {
      visitorId: cleanVid,
      lastSeen: now,
      hasSse: existingSess ? existingSess.hasSse : false,
    });
  }

  // Sweep any expired sessions without firing a duplicate change event inside this call
  for (const [sid, sess] of activeSessions.entries()) {
    if (now - sess.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeSessions.delete(sid);
    }
  }

  const activeUsers = getActiveUniqueUsersCount();
  const activeCountChanged = activeUsers !== prevActiveCount;
  lastBroadcastActiveCount = activeUsers;

  return {
    websiteVisitors: dbCache.totalUniqueVisitors,
    activeUsers,
    isNewVisitor,
    activeCountChanged,
    updatedAt: now,
  };
}

export function registerSseSession(sessionId: string, visitorId: string): boolean {
  if (!isValidAnalyticsId(sessionId) || !isValidAnalyticsId(visitorId)) {
    return false;
  }
  const cleanSid = sessionId.trim();
  const cleanVid = visitorId.trim();
  const prevCount = getActiveUniqueUsersCount();

  const pending = disconnectGraceTimers.get(cleanSid);
  if (pending) {
    clearTimeout(pending);
    disconnectGraceTimers.delete(cleanSid);
  }

  activeSessions.set(cleanSid, {
    visitorId: cleanVid,
    lastSeen: Date.now(),
    hasSse: true,
  });

  // Ensure visitor exists in DB if SSE arrived before heartbeat completed
  if (!dbCache.visitors[cleanVid]) {
    const now = Date.now();
    dbCache.visitors[cleanVid] = {
      firstSeen: now,
      lastSeen: now,
      visitCount: 1,
    };
    dbCache.totalUniqueVisitors = Object.keys(dbCache.visitors).length;
    saveDatabaseSync();
    return true;
  }

  const nextCount = getActiveUniqueUsersCount();
  lastBroadcastActiveCount = nextCount;
  return nextCount !== prevCount;
}

export function touchSseSession(sessionId: string): void {
  if (!isValidAnalyticsId(sessionId)) return;
  const sess = activeSessions.get(sessionId.trim());
  if (sess) {
    sess.lastSeen = Date.now();
    sess.hasSse = true;
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
    // Only expire immediately on SSE drop if no fresh heartbeat arrived since SSE closed
    if (current && !current.hasSse && Date.now() - current.lastSeen >= SSE_DISCONNECT_GRACE_MS - 100) {
      const prevCount = getActiveUniqueUsersCount();
      activeSessions.delete(cleanSid);
      const nextCount = getActiveUniqueUsersCount();
      if (nextCount !== prevCount) {
        lastBroadcastActiveCount = nextCount;
        notifyAnalyticsChange();
      }
    }
  }, SSE_DISCONNECT_GRACE_MS);

  disconnectGraceTimers.set(cleanSid, timer);
}

export function recordSessionLeave(sessionId: string): {
  activeUsers: number;
  changed: boolean;
} {
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

  const now = Date.now();
  for (const [sid, sess] of activeSessions.entries()) {
    if (now - sess.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeSessions.delete(sid);
    }
  }

  const activeUsers = getActiveUniqueUsersCount();
  const changed = activeUsers !== prevCount;
  lastBroadcastActiveCount = activeUsers;

  return { activeUsers, changed };
}

export function getAnalyticsStats(): {
  websiteVisitors: number;
  activeUsers: number;
  verified: boolean;
  updatedAt: number;
} {
  const now = Date.now();
  for (const [sid, sess] of activeSessions.entries()) {
    if (now - sess.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeSessions.delete(sid);
    }
  }
  const activeUsers = getActiveUniqueUsersCount();
  lastBroadcastActiveCount = activeUsers;

  return {
    websiteVisitors: dbCache.totalUniqueVisitors,
    activeUsers,
    verified: true,
    updatedAt: now,
  };
}

// Initial database load
loadDatabase();

// Regular sweep for expired inactive sessions
const sweepTimer = setInterval(() => {
  cleanExpiredSessions();
}, 10000);
sweepTimer.unref?.();

// Flush pending writes cleanly on process exit
process.on("SIGINT", () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveDatabaseSync();
});
process.on("SIGTERM", () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveDatabaseSync();
});
