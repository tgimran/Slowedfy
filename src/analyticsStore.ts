/**
 * Slowedfy Analytics Store
 * Persistent database for:
 * 1. Accurate Unique Monthly Audience (auto-resets each calendar month, zero duplicate inflation on refresh)
 * 2. Real-time Active Users (heartbeat presence with automated session expiry)
 */

import fs from "fs";
import path from "path";

export interface MonthlyRecord {
  visitors: Record<string, { firstSeen: number; lastSeen: number }>;
  count: number;
}

export interface AnalyticsDbSchema {
  months: Record<string, MonthlyRecord>;
  totalAllTimeUnique: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "analytics.json");

// In-memory cache for ultra-fast O(1) performance
let dbCache: AnalyticsDbSchema = {
  months: {},
  totalAllTimeUnique: 0,
};

// In-memory active presence sessions: sessionId -> { visitorId, lastSeen }
const activeSessions = new Map<string, { visitorId: string; lastSeen: number }>();
const ACTIVE_TIMEOUT_MS = 35 * 1000; // 35 seconds of inactivity = session expired

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
      console.error("[Analytics] Error creating data directory:", err);
    }
  }
}

function loadDatabase(): void {
  ensureDataDirectory();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.months === "object") {
        dbCache = parsed;
        return;
      }
    } catch (err) {
      console.warn("[Analytics] Corrupted analytics.json, initializing fresh store:", err);
    }
  }

  // Initialize fresh store
  dbCache = {
    months: {},
    totalAllTimeUnique: 0,
  };
  saveDatabaseSync();
}

let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave(): void {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    saveDatabaseSync();
  }, 1000);
}

function saveDatabaseSync(): void {
  ensureDataDirectory();
  try {
    const tempFile = `${DB_FILE}.tmp_${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2), "utf-8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error("[Analytics] Error saving analytics database:", err);
  }
}

// Current calendar month in format "YYYY-MM" (e.g., "2026-11")
export function getCurrentMonthKey(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function cleanExpiredSessions(): number {
  const now = Date.now();
  for (const [sid, sess] of activeSessions.entries()) {
    if (now - sess.lastSeen > ACTIVE_TIMEOUT_MS) {
      activeSessions.delete(sid);
    }
  }
  // Return unique active visitors
  return new Set(Array.from(activeSessions.values()).map((s) => s.visitorId)).size;
}

export function recordHeartbeat(visitorId: string, sessionId: string): {
  monthlyAudience: number;
  activeUsers: number;
  month: string;
  isNewMonthlyVisitor: boolean;
} {
  const now = Date.now();
  const monthKey = getCurrentMonthKey();

  if (!dbCache.months[monthKey]) {
    dbCache.months[monthKey] = {
      visitors: {},
      count: 0,
    };
  }

  const monthObj = dbCache.months[monthKey];
  let isNewMonthlyVisitor = false;

  if (!monthObj.visitors[visitorId]) {
    monthObj.visitors[visitorId] = {
      firstSeen: now,
      lastSeen: now,
    };
    monthObj.count = Object.keys(monthObj.visitors).length;
    dbCache.totalAllTimeUnique = (dbCache.totalAllTimeUnique || 0) + 1;
    isNewMonthlyVisitor = true;
    scheduleSave();
  } else {
    // Existing visitor this month: update lastSeen without incrementing count
    monthObj.visitors[visitorId].lastSeen = now;
  }

  // Record real-time presence
  if (sessionId) {
    activeSessions.set(sessionId, {
      visitorId,
      lastSeen: now,
    });
  }

  const activeCount = cleanExpiredSessions();

  return {
    monthlyAudience: monthObj.count,
    activeUsers: Math.max(1, activeCount),
    month: monthKey,
    isNewMonthlyVisitor,
  };
}

export function recordSessionLeave(sessionId: string): number {
  if (sessionId && activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
  }
  return cleanExpiredSessions();
}

export function getAnalyticsStats(): {
  monthlyAudience: number;
  activeUsers: number;
  month: string;
} {
  const monthKey = getCurrentMonthKey();
  const monthObj = dbCache.months[monthKey];
  const monthlyAudience = monthObj ? monthObj.count : 0;
  const activeCount = cleanExpiredSessions();

  return {
    monthlyAudience,
    activeUsers: Math.max(0, activeCount),
    month: monthKey,
  };
}

// Initial load
loadDatabase();

// Regular background sweep for expired sessions
setInterval(() => {
  cleanExpiredSessions();
}, 10000);
