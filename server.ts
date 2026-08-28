import express from "express";
import path from "path";
import https from "https";
import http from "http";
import { createServer as createViteServer } from "vite";

const PLAYLIST_ID = "PLkCaFs485nRqjo-8WlwgELRmZZP1dc5HS";
const YOUTUBE_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;

// In-memory cache for fast response and avoiding YouTube rate limits
interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  duration: string;
  seconds: number;
  thumb: string;
  isPremiere?: boolean;
  premiereText?: string;
  startTime?: number;
}

let cachedPlaylist: PlaylistItem[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 45 * 1000; // 45 seconds cache

function fetchUrl(targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith("https") ? https : http;
    const req = client.get(
      targetUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

function parseYouTubePlaylist(html: string): PlaylistItem[] {
  let ytInitialData: any = null;
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/) ||
                html.match(/window\["ytInitialData"\] = ({.*?});/) ||
                html.match(/ytInitialData\s*=\s*({.+?});/s);

  if (match) {
    try {
      ytInitialData = JSON.parse(match[1]);
    } catch (err) {
      console.error("Failed to parse ytInitialData JSON via regex:", err);
    }
  }

  if (!ytInitialData) {
    const idx = html.indexOf("ytInitialData = ");
    if (idx !== -1) {
      const rest = html.slice(idx + "ytInitialData = ".length);
      const endScript = rest.indexOf(";</script>");
      if (endScript !== -1) {
        try {
          ytInitialData = JSON.parse(rest.slice(0, endScript));
        } catch (e) {
          console.error("Failed to parse ytInitialData JSON via slice:", e);
        }
      }
    }
  }

  if (!ytInitialData) {
    return [];
  }

  const videos: PlaylistItem[] = [];
  const seenIds = new Set<string>();

  function extractVideos(obj: any) {
    if (!obj) return;
    if (typeof obj === "object") {
      if (obj.playlistVideoRenderer) {
        const pvr = obj.playlistVideoRenderer;
        const vid = pvr.videoId;
        if (vid && !seenIds.has(vid)) {
          seenIds.add(vid);
          const title =
            pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || "Slowed Track";
          const lengthText = pvr.lengthText?.simpleText || "";
          const lengthSec = pvr.lengthSeconds ? parseInt(pvr.lengthSeconds, 10) : 0;

          let isPremiere = false;
          let premiereText = "Upcoming";
          let startTime = 0;

          // 1. Check upcomingEventData
          if (pvr.upcomingEventData) {
            isPremiere = true;
            premiereText = "Upcoming";
            if (pvr.upcomingEventData.startTime) {
              startTime = parseInt(pvr.upcomingEventData.startTime, 10) * 1000;
            }
          }

          // 2. Check thumbnailOverlays
          if (Array.isArray(pvr.thumbnailOverlays)) {
            for (const ov of pvr.thumbnailOverlays) {
              const t = ov.thumbnailOverlayTimeStatusRenderer;
              if (t) {
                const style = (t.style || "").toUpperCase();
                const text = (t.text?.simpleText || (t.text?.runs?.[0]?.text) || "").toUpperCase();
                const accessibilityLabel = (t.text?.accessibility?.accessibilityData?.label || "").toUpperCase();
                if (
                  style.includes("UPCOMING") ||
                  style.includes("PREMIERE") ||
                  text.includes("UPCOMING") ||
                  text.includes("PREMIERE") ||
                  accessibilityLabel.includes("UPCOMING") ||
                  accessibilityLabel.includes("PREMIERE")
                ) {
                  isPremiere = true;
                  premiereText = t.text?.simpleText || t.text?.runs?.[0]?.text || "Upcoming";
                }
              }
            }
          }

          // 3. Check badges
          if (Array.isArray(pvr.badges)) {
            for (const b of pvr.badges) {
              const label = (b.metadataBadgeRenderer?.label || "").toUpperCase();
              if (label.includes("PREMIERE") || label.includes("UPCOMING")) {
                isPremiere = true;
                premiereText = b.metadataBadgeRenderer?.label || "Upcoming";
              }
            }
          }

          // 4. If duration exists and none of the upcoming markers are present, it is a regular live track
          if (lengthSec > 0 && !pvr.upcomingEventData && !isPremiere) {
            isPremiere = false;
          }

          let artist = "Slowedfy";
          if (title.includes("By Beat Badge × GW IMRAN") || title.includes("GW IMRAN")) {
            artist = "GW IMRAN";
          }

          let sec = lengthSec;
          if (!sec && lengthText && lengthText.includes(":")) {
            const parts = lengthText.split(":").map((p: string) => parseInt(p, 10));
            if (parts.length === 2) {
              sec = parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
              sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
          }

          const formattedDuration = isPremiere
            ? "PREMIERE"
            : (lengthText || (sec ? `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}` : "03:30"));

          videos.push({
            id: vid,
            title,
            artist,
            duration: formattedDuration,
            seconds: sec || 240,
            thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            isPremiere,
            premiereText: isPremiere ? (premiereText || "Upcoming") : undefined,
            startTime: startTime || undefined,
          });
        }
      }
      for (const key of Object.keys(obj)) {
        extractVideos(obj[key]);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        extractVideos(item);
      }
    }
  }

  extractVideos(ytInitialData);
  return videos;
}

async function getLatestPlaylist(forceRefresh = false): Promise<PlaylistItem[]> {
  const now = Date.now();
  if (!forceRefresh && cachedPlaylist && cachedPlaylist.length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedPlaylist;
  }

  try {
    const html = await fetchUrl(YOUTUBE_URL);
    const parsed = parseYouTubePlaylist(html);
    if (parsed && parsed.length > 0) {
      cachedPlaylist = parsed;
      lastFetchTime = now;
      console.log(`[YouTube Sync] Synced ${parsed.length} tracks successfully at ${new Date().toISOString()}`);
      return parsed;
    }
  } catch (error) {
    console.error("[YouTube Sync] Failed to fetch playlist from YouTube:", error);
  }

  return cachedPlaylist || [];
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/api/playlist", async (req, res) => {
    try {
      const force = req.query.refresh === "true";
      const playlist = await getLatestPlaylist(force);
      res.json({
        success: true,
        count: playlist.length,
        lastSync: lastFetchTime,
        playlist,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to fetch playlist",
      });
    }
  });

  // Pre-fetch playlist in background on startup
  getLatestPlaylist(true).catch(() => {});

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Slowedfy Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
