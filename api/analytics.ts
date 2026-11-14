import type { IncomingMessage, ServerResponse } from "http";
import {
  recordHeartbeat,
  recordSessionLeave,
  getAnalyticsStats,
  isValidAnalyticsId,
} from "../src/analyticsStore.ts";

async function readJsonBody(
  req: IncomingMessage & { body?: any }
): Promise<Record<string, any>> {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    if (typeof req.body === "object") {
      return req.body;
    }
  }

  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
      if (raw.length > 16384) {
        resolve({});
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: IncomingMessage & { body?: any; query?: Record<string, string> },
  res: ServerResponse
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Pragma, Cache-Control");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  try {
    if (pathname.endsWith("/heartbeat") && req.method === "POST") {
      const body = await readJsonBody(req);
      const visitorId = String(body.visitorId || "").trim();
      const sessionId = String(body.sessionId || "").trim();

      if (!isValidAnalyticsId(visitorId)) {
        return sendJson(res, 400, {
          success: false,
          verified: false,
          unavailable: false,
          error: "Invalid visitor ID",
        });
      }

      const stats = await recordHeartbeat(visitorId, sessionId);
      if (!stats.verified) {
        return sendJson(res, 503, {
          success: false,
          verified: false,
          unavailable: true,
          websiteVisitors: null,
          activeUsers: null,
          updatedAt: stats.updatedAt,
        });
      }

      return sendJson(res, 200, {
        success: true,
        verified: true,
        unavailable: false,
        websiteVisitors: stats.websiteVisitors,
        activeUsers: stats.activeUsers,
        isNewVisitor: stats.isNewVisitor,
        updatedAt: stats.updatedAt,
      });
    }

    if (pathname.endsWith("/leave") && req.method === "POST") {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId || "").trim();
      const result = await recordSessionLeave(sessionId);
      return sendJson(res, 200, {
        success: result.verified,
        verified: result.verified,
        activeUsers: result.activeUsers,
      });
    }

    // Default: /api/analytics/stats (GET)
    const stats = await getAnalyticsStats();
    if (!stats.verified) {
      return sendJson(res, stats.unavailable ? 503 : 200, {
        success: false,
        ...stats,
      });
    }

    return sendJson(res, 200, {
      success: true,
      ...stats,
    });
  } catch (err: any) {
    return sendJson(res, 500, {
      success: false,
      verified: false,
      unavailable: true,
      error: err?.message || "Analytics service error",
    });
  }
}
