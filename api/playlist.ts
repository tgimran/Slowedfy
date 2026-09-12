import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";
import { OFFICIAL_PLAYLIST, DEFAULT_PLAYLIST_ID, PlaylistItem } from "../src/defaultPlaylist";

function cleanPlaylistId(input?: string): string {
  if (!input) return DEFAULT_PLAYLIST_ID;
  const trimmed = String(input).trim();
  const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch) return listMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return DEFAULT_PLAYLIST_ID;
}

function fetchUrl(targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
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
          Pragma: "no-cache",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
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

  if (pvr.upcomingEventData) {
    isPremiere = true;
    premiereText = pvr.upcomingEventData.upcomingEventText?.runs?.map((r: any) => r.text).join("") || "Upcoming";
    if (pvr.upcomingEventData.startTime) {
      startTime = parseInt(pvr.upcomingEventData.startTime, 10) * 1000;
    }
  }

  if (Array.isArray(pvr.thumbnailOverlays)) {
    for (const ov of pvr.thumbnailOverlays) {
      const t = ov.thumbnailOverlayTimeStatusRenderer;
      if (t) {
        const text = (t.text?.simpleText || (t.text?.runs?.[0]?.text) || "").toUpperCase();
        if (text.includes("UPCOMING") || text.includes("PREMIERE")) {
          isPremiere = true;
          premiereText = t.text?.simpleText || t.text?.runs?.[0]?.text || premiereText;
        }
      }
    }
  }

  let artist = "Slowedfy";
  if (title.includes("By Beat Badge × GW IMRAN") || title.includes("GW IMRAN")) {
    artist = "GW IMRAN";
  }

  let sec = lengthSec;
  if (!sec && lengthText && lengthText.includes(":")) {
    const parts = lengthText.split(":").map((p: string) => parseInt(p, 10));
    if (parts.length === 2) sec = parts[0] * 60 + parts[1];
    else if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return {
    id: vid,
    title,
    artist,
    duration: isPremiere ? "PREMIERE" : (lengthText || (sec ? `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}` : "03:30")),
    seconds: sec || 240,
    thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    isPremiere,
    premiereText: isPremiere ? premiereText : undefined,
    startTime: startTime || undefined,
  };
}

async function fetchFromYouTube(playlistId: string): Promise<{ videos: PlaylistItem[]; title?: string; author?: string }> {
  try {
    const html = await fetchUrl(`https://www.youtube.com/playlist?list=${playlistId}`);
    let ytInitialData: any = null;
    const jsonMatch = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
    if (jsonMatch) {
      try { ytInitialData = JSON.parse(jsonMatch[1]); } catch (e) {}
    }

    if (!ytInitialData) {
      const windowMatch = html.match(/window\["ytInitialData"\] = ({[\s\S]*?});<\/script>/);
      if (windowMatch) {
        try { ytInitialData = JSON.parse(windowMatch[1]); } catch (e) {}
      }
    }

    if (!ytInitialData) return { videos: [] };

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

    const videos: PlaylistItem[] = [];
    const seenIds = new Set<string>();

    function walk(obj: any) {
      if (!obj) return;
      if (typeof obj === "object") {
        if (obj.playlistVideoRenderer) {
          const item = parseVideoRenderer(obj.playlistVideoRenderer, seenIds);
          if (item) videos.push(item);
        }
        for (const key of Object.keys(obj)) walk(obj[key]);
      } else if (Array.isArray(obj)) {
        for (const item of obj) walk(item);
      }
    }

    walk(ytInitialData);
    return { videos, title, author };
  } catch (err) {
    return { videos: [] };
  }
}

async function fetchRssVideos(playlistId: string): Promise<PlaylistItem[]> {
  try {
    const rssXml = await fetchUrl(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}&_t=${Date.now()}`);
    const entries = rssXml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const videos: PlaylistItem[] = [];
    for (const e of entries) {
      const vidMatch = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const vid = vidMatch ? vidMatch[1].trim() : "";
      if (!vid) continue;
      const titleMatch = e.match(/<media:title>([^<]+)<\/media:title>/) || e.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim() : "Slowed Track";
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
    return [];
  }
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string> }, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Pragma, Cache-Control");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const playlistId = cleanPlaylistId(url.searchParams.get("id") || url.searchParams.get("list") || DEFAULT_PLAYLIST_ID);

    const [htmlResult, rssVideos] = await Promise.allSettled([
      fetchFromYouTube(playlistId),
      fetchRssVideos(playlistId),
    ]);

    const parsed = htmlResult.status === "fulfilled" ? htmlResult.value : { videos: [] };
    const rss = rssVideos.status === "fulfilled" ? rssVideos.value : [];

    let combinedVideos: PlaylistItem[] = parsed.videos && parsed.videos.length > 0 ? [...parsed.videos] : [];

    // Prepend any new tracks from RSS
    if (rss.length > 0) {
      const existingIds = new Set(combinedVideos.map((v) => v.id));
      const brandNew = rss.filter((rv) => !existingIds.has(rv.id));
      if (brandNew.length > 0) {
        combinedVideos = [...brandNew, ...combinedVideos];
      }
    }

    // If official playlist, guarantee all 106 official songs are included
    if (playlistId === DEFAULT_PLAYLIST_ID) {
      const currentIds = new Set(combinedVideos.map((v) => v.id));
      const missing = OFFICIAL_PLAYLIST.filter((v) => !currentIds.has(v.id));
      if (missing.length > 0) {
        combinedVideos = [...combinedVideos, ...missing];
      }
    }

    // Final fallback
    if (combinedVideos.length === 0 && playlistId === DEFAULT_PLAYLIST_ID) {
      combinedVideos = [...OFFICIAL_PLAYLIST];
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        playlistId,
        title: parsed.title || "Slowedfy Official Playlist",
        author: parsed.author || "Slowedfy",
        count: combinedVideos.length,
        playlist: combinedVideos,
        lastSync: Date.now(),
      })
    );
  } catch (err: any) {
    // If error occurs, still return the full official playlist if default
    const fallbackList = OFFICIAL_PLAYLIST;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        playlistId: DEFAULT_PLAYLIST_ID,
        title: "Slowedfy Official Playlist",
        author: "Slowedfy",
        count: fallbackList.length,
        playlist: fallbackList,
        lastSync: Date.now(),
      })
    );
  }
}
