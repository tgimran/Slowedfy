import express from "express";
import path from "path";
import https from "https";
import http from "http";
import { createServer as createViteServer } from "vite";
import { OFFICIAL_PLAYLIST, DEFAULT_PLAYLIST_ID as FALLBACK_ID, PlaylistItem as BasePlaylistItem } from "./src/defaultPlaylist";

const DEFAULT_PLAYLIST_ID = FALLBACK_ID;

export function cleanPlaylistId(input?: string): string {
  if (!input) return DEFAULT_PLAYLIST_ID;
  const trimmed = input.trim();
  const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch) return listMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return DEFAULT_PLAYLIST_ID;
}

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

interface PlaylistCacheEntry {
  playlistId: string;
  title: string;
  playlist: PlaylistItem[];
  lastFetchTime: number;
}

const playlistCache = new Map<string, PlaylistCacheEntry>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds cache

function fetchUrl(targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    // Add cache busting param to avoid YouTube caching old playlist versions
    urlObj.searchParams.set("disable_polymer", "true");
    urlObj.searchParams.set("hl", "en");
    urlObj.searchParams.set("_t", Date.now().toString());

    const client = urlObj.protocol === "https:" ? https : http;
    const req = client.get(
      urlObj.toString(),
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
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

function postJson(targetUrl: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(payload);
    const urlObj = new URL(targetUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dataStr),
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20240101.00.00",
        "Origin": "https://www.youtube.com",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("POST timeout"));
    });
    req.write(dataStr);
    req.end();
  });
}

function extractContinuationToken(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  const cir = obj.continuationItemRenderer || obj;
  const endpoint = cir.continuationEndpoint;
  if (!endpoint) return null;

  const directCmd = endpoint.continuationCommand;
  if (directCmd && directCmd.token) {
    return directCmd.token;
  }

  const execCmds = endpoint.commandExecutorCommand?.commands;
  if (Array.isArray(execCmds)) {
    for (const ec of execCmds) {
      const cc = ec.continuationCommand;
      if (cc && cc.token) {
        return cc.token;
      }
    }
  }
  return null;
}

function parseVideoRenderer(pvr: any, seenIds: Set<string>): PlaylistItem | null {
  const vid = pvr?.videoId;
  if (!vid || seenIds.has(vid)) return null;
  seenIds.add(vid);

  const title = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || "Slowed Track";
  const lengthText = pvr.lengthText?.simpleText || "";
  const lengthSec = pvr.lengthSeconds ? parseInt(pvr.lengthSeconds, 10) : 0;

  let isPremiere = false;
  let premiereText = "Upcoming";
  let startTime = 0;

  // 1. Check upcomingEventData
  if (pvr.upcomingEventData) {
    isPremiere = true;
    premiereText = pvr.upcomingEventData.upcomingEventText?.runs?.map((r: any) => r.text).join("") || "Upcoming";
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
          premiereText = t.text?.simpleText || t.text?.runs?.[0]?.text || premiereText || "Upcoming";
        }
      }
    }
  }

  // 3. Check badges
  if (Array.isArray(pvr.badges)) {
    for (const b of pvr.badges) {
      const label = (b.metadataBadgeRenderer?.label || "").toUpperCase();
      if (label.includes("PREMIERE") || label.includes("UPCOMING") || label.includes("LIVE")) {
        isPremiere = true;
        premiereText = b.metadataBadgeRenderer?.label || premiereText || "Upcoming";
      }
    }
  }

  // 4. Check videoInfo runs (e.g. "Premieres 09/02/26", "Live in 2 days", "Upcoming")
  if (Array.isArray(pvr.videoInfo?.runs)) {
    for (const r of pvr.videoInfo.runs) {
      const txt = (r.text || "").toUpperCase();
      if (txt.includes("PREMIERE") || txt.includes("UPCOMING") || txt.includes("LIVE IN") || txt.includes("SCHEDULED")) {
        isPremiere = true;
        premiereText = r.text || premiereText || "Upcoming";
      }
    }
  }

  // 5. Check publishedTimeText
  if (pvr.publishedTimeText?.simpleText) {
    const pubTxt = pvr.publishedTimeText.simpleText.toUpperCase();
    if (pubTxt.includes("PREMIERE") || pubTxt.includes("UPCOMING")) {
      isPremiere = true;
      premiereText = pvr.publishedTimeText.simpleText || premiereText || "Upcoming";
    }
  }

  // 6. Zero length with no duration text indicates unreleased / upcoming premiere
  if (lengthSec === 0 && !lengthText && !isPremiere) {
    isPremiere = true;
    premiereText = "Upcoming";
  }

  // 7. If duration exists and none of upcoming markers, regular track
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

  return {
    id: vid,
    title,
    artist,
    duration: formattedDuration,
    seconds: sec || 240,
    thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    isPremiere,
    premiereText: isPremiere ? (premiereText || "Upcoming") : undefined,
    startTime: startTime || undefined,
  };
}

interface ParsedPlaylistResult {
  videos: PlaylistItem[];
  title?: string;
  author?: string;
}

async function fetchFullYouTubePlaylist(html: string): Promise<ParsedPlaylistResult> {
  let ytInitialData: any = null;
  const match =
    html.match(/var ytInitialData = ({.*?});<\/script>/) ||
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
    return { videos: [] };
  }

  // Extract playlist title and author
  let title = "Slowedfy Playlist";
  let author = "Slowedfy";
  try {
    const rawTitle =
      ytInitialData?.header?.playlistHeaderRenderer?.title?.simpleText ||
      ytInitialData?.header?.playlistHeaderRenderer?.title?.runs?.[0]?.text ||
      ytInitialData?.metadata?.playlistMetadataRenderer?.title;
    if (rawTitle) title = String(rawTitle).trim();

    const rawAuthor =
      ytInitialData?.header?.playlistHeaderRenderer?.ownerText?.runs?.[0]?.text ||
      ytInitialData?.metadata?.playlistMetadataRenderer?.author;
    if (rawAuthor) author = String(rawAuthor).trim();
  } catch (e) {}

  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

  const videos: PlaylistItem[] = [];
  const seenIds = new Set<string>();
  const continuationTokens: string[] = [];

  function walk(obj: any) {
    if (!obj) return;
    if (typeof obj === "object") {
      if (obj.playlistVideoRenderer) {
        const item = parseVideoRenderer(obj.playlistVideoRenderer, seenIds);
        if (item) videos.push(item);
      }
      if (obj.continuationItemRenderer) {
        const tok = extractContinuationToken(obj.continuationItemRenderer);
        if (tok) continuationTokens.push(tok);
      }
      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item);
      }
    }
  }

  walk(ytInitialData);

  // Paginate through continuations to fetch all songs beyond 100
  let loopCount = 0;
  while (continuationTokens.length > 0 && loopCount < 20) {
    loopCount++;
    const nextToken = continuationTokens.shift();
    if (!nextToken) continue;

    try {
      const browseUrl = `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`;
      const payload = {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
            hl: "en",
            gl: "US",
          },
        },
        continuation: nextToken,
      };

      const cData = await postJson(browseUrl, payload);
      const actions = [
        ...(cData.onResponseReceivedActions || []),
        ...(cData.onResponseReceivedEndpoints || []),
      ];

      for (const act of actions) {
        const contItems = act.appendContinuationItemsAction?.continuationItems || [];
        for (const ci of contItems) {
          if (ci.playlistVideoRenderer) {
            const item = parseVideoRenderer(ci.playlistVideoRenderer, seenIds);
            if (item) videos.push(item);
          }
          if (ci.continuationItemRenderer) {
            const tok = extractContinuationToken(ci.continuationItemRenderer);
            if (tok) continuationTokens.push(tok);
          }
        }
      }
    } catch (err) {
      console.error("[YouTube Sync] Continuation fetch error:", err);
    }
  }

  return { videos, title, author };
}

const KNOWN_SHORTS_IDS = new Set([
  "AxIiQDuYnNY", "pnfhU5M0NxE", "dACfofdKdfY", "AiyVQGn6DT8",
  "MrBpcs3_qJE", "EfOeSZVnCyc", "z6I4vznbokI"
]);

function isShortTrack(id: string, title: string = "", xmlEntry: string = ""): boolean {
  if (KNOWN_SHORTS_IDS.has(id)) return true;
  if (xmlEntry && xmlEntry.includes("/shorts/")) return true;
  const lower = title.toLowerCase();
  if (lower.includes("#shorts") || lower.includes("#short") || lower.includes("shorts")) return true;
  return false;
}

async function fetchYouTubeRssVideos(playlistId: string): Promise<PlaylistItem[]> {
  try {
    // Only fetch the official YouTube Playlist RSS feed (never channel feed to avoid Shorts)
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}&_t=${Date.now()}`;
    const xml = await fetchUrl(rssUrl);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const videos: PlaylistItem[] = [];
    const seen = new Set<string>();

    for (const e of entries) {
      const vidMatch = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const vid = vidMatch ? vidMatch[1].trim() : null;
      if (!vid || seen.has(vid)) continue;

      const titleMatch = e.match(/<media:title>([^<]+)<\/media:title>/) || e.match(/<title>([^<]+)<\/title>/);
      let title = titleMatch
        ? titleMatch[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .trim()
        : "Slowed Track";

      // Reject all YouTube Shorts
      if (isShortTrack(vid, title, e)) continue;

      seen.add(vid);

      let artist = "Slowedfy";
      if (title.includes("By Beat Badge × GW IMRAN") || title.includes("GW IMRAN")) {
        artist = "GW IMRAN";
      }

      videos.push({
        id: vid,
        title,
        artist,
        duration: "03:30",
        seconds: 210,
        thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        isPremiere: false,
      });
    }
    return videos;
  } catch (err) {
    console.warn(`[YouTube RSS] Failed to fetch RSS for ${playlistId}:`, err);
    return [];
  }
}

async function getLatestPlaylist(
  playlistId: string = DEFAULT_PLAYLIST_ID,
  forceRefresh = false
): Promise<{ playlist: PlaylistItem[]; title: string; author: string; lastFetchTime: number }> {
  const normalizedId = cleanPlaylistId(playlistId);
  const now = Date.now();
  const cached = playlistCache.get(normalizedId);

  if (!forceRefresh && cached && cached.playlist.length > 0 && now - cached.lastFetchTime < 10000) {
    return {
      playlist: cached.playlist,
      title: cached.title,
      author: "Slowedfy",
      lastFetchTime: cached.lastFetchTime,
    };
  }

  try {
    const youtubeUrl = `https://www.youtube.com/playlist?list=${normalizedId}`;
    
    // Fetch HTML scrape and RSS feed concurrently for zero-latency detection of new songs
    const [htmlResult, rssVideos] = await Promise.allSettled([
      fetchUrl(youtubeUrl).then(html => fetchFullYouTubePlaylist(html)),
      fetchYouTubeRssVideos(normalizedId)
    ]);

    const parsed = htmlResult.status === "fulfilled" ? htmlResult.value : null;
    const rss = rssVideos.status === "fulfilled" ? rssVideos.value : [];

    let combinedVideos: PlaylistItem[] = parsed?.videos ? [...parsed.videos] : [];

    // Check if RSS feed has any brand new videos that YouTube HTML edge cache hasn't indexed yet
    if (rss.length > 0) {
      const existingIds = new Set(combinedVideos.map(v => v.id));
      const brandNewFromRss: PlaylistItem[] = [];
      for (const rv of rss) {
        if (!existingIds.has(rv.id)) {
          brandNewFromRss.push(rv);
          existingIds.add(rv.id);
        }
      }
      if (brandNewFromRss.length > 0) {
        console.log(`[YouTube Sync] Detected ${brandNewFromRss.length} brand new track(s) from YouTube RSS feed:`, brandNewFromRss.map(t => t.title));
        combinedVideos = [...brandNewFromRss, ...combinedVideos];
      }
    }

    // Strictly filter out any shorts - only full playlist songs allowed
    combinedVideos = combinedVideos.filter(v => !isShortTrack(v.id, v.title));

    // If syncing the default official playlist, guarantee all 106 official tracks are present
    if (normalizedId === DEFAULT_PLAYLIST_ID) {
      const currentIds = new Set(combinedVideos.map(v => v.id));
      const missingFromOfficial = OFFICIAL_PLAYLIST.filter(v => !currentIds.has(v.id));
      if (missingFromOfficial.length > 0) {
        combinedVideos = [...combinedVideos, ...(missingFromOfficial as PlaylistItem[])];
      }

      // Ensure Track 01 is strictly the newest official release
      const topIdx = combinedVideos.findIndex(v => v.id === OFFICIAL_PLAYLIST[0].id);
      if (topIdx > 0 && combinedVideos.length === OFFICIAL_PLAYLIST.length) {
        const [topTrack] = combinedVideos.splice(topIdx, 1);
        combinedVideos.unshift(topTrack);
      }
    }

    if (combinedVideos.length > 0) {
      const entry: PlaylistCacheEntry = {
        playlistId: normalizedId,
        title: parsed?.title || (rss.length > 0 ? "Slowedfy Playlist" : "Slowedfy"),
        playlist: combinedVideos,
        lastFetchTime: now,
      };
      playlistCache.set(normalizedId, entry);
      console.log(`[YouTube Sync] Synced ${combinedVideos.length} tracks for playlist ${normalizedId} ("${entry.title}") successfully at ${new Date().toISOString()}`);
      return {
        playlist: combinedVideos,
        title: entry.title,
        author: parsed?.author || "Slowedfy",
        lastFetchTime: now,
      };
    }
  } catch (error) {
    console.error(`[YouTube Sync] Failed to fetch playlist ${normalizedId} from YouTube:`, error);
  }

  if (cached && cached.playlist.length > 0) {
    return {
      playlist: cached.playlist,
      title: cached.title,
      author: "Slowedfy",
      lastFetchTime: cached.lastFetchTime,
    };
  }

  if (normalizedId === DEFAULT_PLAYLIST_ID) {
    return {
      playlist: OFFICIAL_PLAYLIST as PlaylistItem[],
      title: "Slowedfy Official Playlist",
      author: "Slowedfy",
      lastFetchTime: now,
    };
  }

  return {
    playlist: [],
    title: "Slowedfy Playlist",
    author: "Slowedfy",
    lastFetchTime: now,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Global CORS Middleware for public website & iframe access
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Pragma, Cache-Control");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/api/playlist", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const playlistId = cleanPlaylistId(String(req.query.id || req.query.url || req.query.list || ""));
      const force = req.query.refresh === "true";
      const result = await getLatestPlaylist(playlistId, force);
      res.json({
        success: true,
        playlistId,
        title: result.title,
        author: result.author,
        count: result.playlist.length,
        lastSync: result.lastFetchTime,
        playlist: result.playlist,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to fetch playlist",
      });
    }
  });

  app.post("/api/playlist/sync", async (req, res) => {
    try {
      const playlistId = cleanPlaylistId(String(req.body?.playlistId || req.body?.url || req.query.id || ""));
      const force = req.body?.force !== false;
      const result = await getLatestPlaylist(playlistId, force);
      res.json({
        success: true,
        playlistId,
        title: result.title,
        author: result.author,
        count: result.playlist.length,
        lastSync: result.lastFetchTime,
        playlist: result.playlist,
        syncedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || "Failed to sync playlist",
      });
    }
  });

  app.get("/api/playlist/presets", (req, res) => {
    res.json({
      success: true,
      presets: [
        {
          id: "PLkCaFs485nRqjo-8WlwgELRmZZP1dc5HS",
          title: "Slowedfy Official (Beat Badge × Slowedfy)",
          genre: "Slowed + Reverb Bollywood & Lo-Fi",
          isDefault: true,
          badge: "Official",
        },
        {
          id: "PL4fGSI1pDJn6jXS_PEoNEDWnII3799n2X",
          title: "Top Bollywood Lo-Fi / Slowed",
          genre: "Indian Lo-Fi & Chill Vibes",
          badge: "Lo-Fi",
        },
        {
          id: "PLofht4PTcKYnaH8w5gkDC264ozXt1hm6b",
          title: "Lofi Girl - Synthwave Beats",
          genre: "Synthwave / Chillwave",
          badge: "Chill",
        },
        {
          id: "PLozUcUwZkXmKj6Q8qQ22_i-0g5Y4uU_gM",
          title: "Midnight Dream Lo-Fi",
          genre: "Midnight Ambient & Study",
          badge: "Midnight",
        }
      ]
    });
  });

  // Pre-fetch default official playlist on startup and poll every 15 seconds
  getLatestPlaylist(DEFAULT_PLAYLIST_ID, true).catch(() => {});
  setInterval(() => {
    getLatestPlaylist(DEFAULT_PLAYLIST_ID, true).catch(() => {});
  }, 15000);

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
