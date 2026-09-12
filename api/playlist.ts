import type { IncomingMessage, ServerResponse } from "http";
import https from "https";

const DEFAULT_PLAYLIST_ID = "PLkCaFs485nRqjo-8WlwgELRmZZP1dc5HS";

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

    https.get(
      urlObj.toString(),
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    ).on("error", reject);
  });
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

    // Fetch RSS feed
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}&_t=${Date.now()}`;
    const rssXml = await fetchUrl(rssUrl);
    const entries = rssXml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    const videos = entries.map((e) => {
      const vidMatch = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const vid = vidMatch ? vidMatch[1].trim() : "";
      const titleMatch = e.match(/<media:title>([^<]+)<\/media:title>/) || e.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch
        ? titleMatch[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .trim()
        : "Slowed Track";

      let artist = "Slowedfy";
      if (title.includes("By Beat Badge × GW IMRAN") || title.includes("GW IMRAN")) {
        artist = "GW IMRAN";
      }

      return {
        id: vid,
        title,
        artist,
        duration: "03:30",
        seconds: 210,
        thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        isPremiere: false,
      };
    }).filter((v) => !!v.id);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        playlistId,
        title: "Slowedfy Official Playlist",
        count: videos.length,
        playlist: videos,
      })
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}
