import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

// Fetch byte range from URL with redirect following
function fetchRange(url: string, maxBytes = 2500000, redirectsRemaining = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Range": `bytes=0-${maxBytes}`,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsRemaining > 0) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, parsed.origin).href;
          res.resume();
          return fetchRange(next, maxBytes, redirectsRemaining - 1).then(resolve).catch(reject);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= maxBytes) {
            res.destroy();
            resolve(Buffer.concat(chunks));
          }
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// Pure Node.js embedded MP3 ID3 APIC picture extractor (zero external binaries required)
export function extractId3Picture(buf: Buffer): { mime: string; data: Buffer } | null {
  if (!buf || buf.length < 32) return null;

  // Search for APIC frame (ID3v2.3, ID3v2.4) or PIC (ID3v2.2)
  let frameIdx = buf.indexOf("APIC");
  if (frameIdx === -1) frameIdx = buf.indexOf("PIC");

  const startSearch = frameIdx !== -1 ? frameIdx : 0;

  // Look for JPEG start marker (FF D8 FF)
  const jpgStart = buf.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), startSearch);
  if (jpgStart !== -1) {
    let lastJpgEnd = -1;
    let pos = jpgStart;
    while ((pos = buf.indexOf(Buffer.from([0xFF, 0xD9]), pos + 1)) !== -1) {
      lastJpgEnd = pos;
    }
    if (lastJpgEnd !== -1 && lastJpgEnd > jpgStart) {
      const imgData = buf.slice(jpgStart, lastJpgEnd + 2);
      if (imgData.length > 2000) {
        return { mime: "image/jpeg", data: imgData };
      }
    }
  }

  // Look for PNG header (89 50 4E 47 0D 0A 1A 0A)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const pngStart = buf.indexOf(pngHeader, startSearch);
  if (pngStart !== -1) {
    const iend = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
    const pngEnd = buf.indexOf(iend, pngStart);
    if (pngEnd !== -1 && pngEnd > pngStart) {
      const imgData = buf.slice(pngStart, pngEnd + 8);
      if (imgData.length > 2000) {
        return { mime: "image/png", data: imgData };
      }
    }
  }

  return null;
}

// iTunes Search API fallback
async function fetchItunesCover(query: string): Promise<string | null> {
  try {
    const cleanQuery = query
      .replace(/[│｜|]/g, " ")
      .replace(/\(Slowed\s*\+?\s*Reverb\)/gi, "")
      .replace(/\(Slowed\s*-?\s*Reverb\)/gi, "")
      .replace(/By Beat Badge.*$/gi, "")
      .replace(/\.mp3.*$/gi, "")
      .trim();

    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&media=music&entity=song&limit=1`;
    const res = await new Promise<string>((resolve, reject) => {
      https.get(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => resolve(d));
      }).on("error", reject);
    });

    const parsed = JSON.parse(res);
    if (parsed.results && parsed.results.length > 0) {
      const rawArt = parsed.results[0].artworkUrl100;
      if (rawArt) {
        return rawArt.replace("100x100bb.jpg", "1000x1000bb.jpg");
      }
    }
  } catch (e) {}
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, Pragma, Cache-Control");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "", "http://localhost");
  const trackId = reqUrl.searchParams.get("id");
  const isThumb = reqUrl.searchParams.get("size") === "thumb";

  if (!trackId || !/^[a-zA-Z0-9_-]{10,}$/.test(trackId)) {
    res.statusCode = 400;
    res.end("Invalid track ID");
    return;
  }

  // 1. Check local static covers on disk
  const candidates = [
    isThumb ? path.join(process.cwd(), "public", "covers", "thumbs", `${trackId}.jpg`) : null,
    isThumb ? path.join(process.cwd(), "dist", "covers", "thumbs", `${trackId}.jpg`) : null,
    path.join(process.cwd(), "public", "covers", `${trackId}.jpg`),
    path.join(process.cwd(), "dist", "covers", `${trackId}.jpg`),
    path.join(process.cwd(), "public", "covers", "thumbs", `${trackId}.jpg`),
    path.join(process.cwd(), "dist", "covers", "thumbs", `${trackId}.jpg`),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 1000) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(fs.readFileSync(p));
        return;
      }
    } catch (e) {}
  }

  // 2. Dynamic pure Node.js extraction from Google Drive stream
  try {
    const driveUrl = `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;
    const buf = await fetchRange(driveUrl, 2500000);
    const pic = extractId3Picture(buf);
    if (pic && pic.data && pic.data.length > 2000) {
      // Save to disk if writable
      try {
        const outDir = path.join(process.cwd(), "public", "covers");
        const thumbDir = path.join(outDir, "thumbs");
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${trackId}.jpg`), pic.data);
        fs.writeFileSync(path.join(thumbDir, `${trackId}.jpg`), pic.data);
      } catch (e) {}

      res.statusCode = 200;
      res.setHeader("Content-Type", pic.mime);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(pic.data);
      return;
    }
  } catch (err) {
    console.warn("Direct ID3 artwork extraction error:", err);
  }

  // 3. Fallback to iTunes Search API for official artwork
  try {
    const query = reqUrl.searchParams.get("title");
    if (query) {
      const itunesUrl = await fetchItunesCover(query);
      if (itunesUrl) {
        res.statusCode = 302;
        res.setHeader("Location", itunesUrl);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.end();
        return;
      }
    }
  } catch (e) {}

  // 4. Default fallback logo
  res.statusCode = 302;
  res.setHeader("Location", "/assets/logo.png");
  res.end();
}
