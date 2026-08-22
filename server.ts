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
                html.match(/window\["ytInitialData"\] = ({.*?});/);

  if (match) {
    try {
      ytInitialData = JSON.parse(match[1]);
    } catch (err) {
      console.error("Failed to parse ytInitialData JSON:", err);
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
          const lengthSec = pvr.lengthSeconds;

          let isPremiere = false;
          let premiereText = "PREMIERE";
          let startTime = 0;

          // Check upcoming / premiere object
          if (pvr.upcomingEventData) {
            isPremiere = true;
            premiereText = "PREMIERE";
            if (pvr.upcomingEventData.startTime) {
              startTime = parseInt(pvr.upcomingEventData.startTime, 10) * 1000;
            }
          }

          // Check badges
          if (Array.isArray(pvr.badges)) {
            for (const b of pvr.badges) {
              const label = b.metadataBadgeRenderer?.label || "";
              if (
                label.toUpperCase().includes("PREMIERE") ||
                label.toUpperCase().includes("UPCOMING") ||
                label.toUpperCase().includes("LIVE")
              ) {
                isPremiere = true;
                premiereText = label.toUpperCase();
              }
            }
          }

          // Check thumbnail overlays
          if (Array.isArray(pvr.thumbnailOverlays)) {
            for (const ov of pvr.thumbnailOverlays) {
              const t = ov.thumbnailOverlayTimeStatusRenderer;
              if (t) {
                const style = t.style || "";
                const text = t.text?.simpleText || "";
                if (
                  style.includes("UPCOMING") ||
                  style.includes("PREMIERE") ||
                  style.includes("LIVE") ||
                  text.toUpperCase().includes("PREMIERE") ||
                  text.toUpperCase().includes("UPCOMING")
                ) {
                  isPremiere = true;
                  premiereText = text || "PREMIERE";
                }
              }
            }
          }

          // Check title for premiere keywords
          const upperTitle = title.toUpperCase();
          if (
            upperTitle.includes("[PREMIERE]") ||
            upperTitle.includes("(PREMIERE)") ||
            (!lengthText && upperTitle.includes("PREMIERE"))
          ) {
            isPremiere = true;
          }

          let artist = "Slowedfy";
          if (title.includes("By Beat Badge × GW IMRAN") || title.includes("GW IMRAN")) {
            artist = "GW IMRAN";
          }

          let sec = 0;
          if (lengthSec) {
            sec = parseInt(lengthSec, 10);
          } else if (lengthText && lengthText.includes(":")) {
            const parts = lengthText.split(":").map((p: string) => parseInt(p, 10));
            if (parts.length === 2) {
              sec = parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
              sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
          }

          videos.push({
            id: vid,
            title,
            artist,
            duration: lengthText || (isPremiere ? "PREMIERE" : "03:30"),
            seconds: sec || 210,
            thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            isPremiere,
            premiereText: isPremiere ? premiereText : undefined,
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
