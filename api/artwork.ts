import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

// Fetch byte range from URL with redirect following
function fetchRange(url: string, maxBytes = 350000, redirectsRemaining = 5): Promise<Buffer> {
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "*/*",
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

// Pure Node.js robust embedded MP3 ID3 APIC picture extractor (zero external binaries required)
export function extractId3Picture(buf: Buffer): { mime: string; data: Buffer } | null {
  if (!buf || buf.length < 32) return null;

  let apicIdx = buf.indexOf("APIC");
  let isPic = false;
  if (apicIdx === -1) {
    apicIdx = buf.indexOf("PIC");
    isPic = true;
  }

  if (apicIdx !== -1) {
    let frameSize = 0;
    let dataOffset = apicIdx + 10;
    if (isPic) {
      frameSize = (buf[apicIdx + 3] << 16) | (buf[apicIdx + 4] << 8) | buf[apicIdx + 5];
      dataOffset = apicIdx + 6;
    } else {
      const isV24 = buf.length > 3 && buf[3] === 4;
      if (isV24) {
        frameSize =
          ((buf[apicIdx + 4] & 0x7f) << 21) |
          ((buf[apicIdx + 5] & 0x7f) << 14) |
          ((buf[apicIdx + 6] & 0x7f) << 7) |
          (buf[apicIdx + 7] & 0x7f);
      } else {
        frameSize = buf.readUInt32BE(apicIdx + 4);
      }
    }

    if (frameSize > 500 && frameSize < 15000000) {
      const frameData = buf.slice(dataOffset, Math.min(dataOffset + frameSize, buf.length));
      // 1. Look for JPEG start marker
      const jpgStart = frameData.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      if (jpgStart !== -1) {
        const lastJpgEnd = frameData.lastIndexOf(Buffer.from([0xff, 0xd9]));
        if (lastJpgEnd > jpgStart) {
          const img = frameData.slice(jpgStart, lastJpgEnd + 2);
          if (img.length > 2000) return { mime: "image/jpeg", data: img };
        } else if (frameData.length >= frameSize - 100) {
          const img = frameData.slice(jpgStart);
          if (img.length > 2000) return { mime: "image/jpeg", data: img };
        }
      }
      // 2. Look for PNG start marker
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const pngStart = frameData.indexOf(pngHeader);
      if (pngStart !== -1) {
        const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
        const pngEnd = frameData.indexOf(iend, pngStart);
        if (pngEnd !== -1) {
          const img = frameData.slice(pngStart, pngEnd + 8);
          if (img.length > 2000) return { mime: "image/png", data: img };
        }
      }
    }
  }

  // Generic fallback if APIC header was non-standard
  const jpgStart = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (jpgStart !== -1 && jpgStart < 300000) {
    let lastJpgEnd = -1;
    let pos = jpgStart;
    while ((pos = buf.indexOf(Buffer.from([0xff, 0xd9]), pos + 1)) !== -1 && pos < 5000000) {
      lastJpgEnd = pos;
    }
    if (lastJpgEnd > jpgStart && lastJpgEnd - jpgStart > 2000) {
      return { mime: "image/jpeg", data: buf.slice(jpgStart, lastJpgEnd + 2) };
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
    let buf = await fetchRange(driveUrl, 350000);

    // If ID3 header indicates a larger metadata block (e.g. 1-3 MB high-res embedded cover), fetch exact bytes
    if (buf.length > 10 && buf.slice(0, 3).toString() === "ID3") {
      const tagSize =
        ((buf[6] & 0x7f) << 21) |
        ((buf[7] & 0x7f) << 14) |
        ((buf[8] & 0x7f) << 7) |
        (buf[9] & 0x7f);
      if (tagSize > 350000 && tagSize < 12000000) {
        buf = await fetchRange(driveUrl, tagSize + 2048);
      }
    }

    const pic = extractId3Picture(buf);
    if (pic && pic.data && pic.data.length > 2000) {
      // Save to disk if writable
      try {
        const outDir = path.join(process.cwd(), "public", "covers");
        const thumbDir = path.join(outDir, "thumbs");
        const distOutDir = path.join(process.cwd(), "dist", "covers");
        const distThumbDir = path.join(distOutDir, "thumbs");

        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${trackId}.jpg`), pic.data);
        fs.writeFileSync(path.join(thumbDir, `${trackId}.jpg`), pic.data);

        if (fs.existsSync(path.join(process.cwd(), "dist"))) {
          if (!fs.existsSync(distOutDir)) fs.mkdirSync(distOutDir, { recursive: true });
          if (!fs.existsSync(distThumbDir)) fs.mkdirSync(distThumbDir, { recursive: true });
          fs.writeFileSync(path.join(distOutDir, `${trackId}.jpg`), pic.data);
          fs.writeFileSync(path.join(distThumbDir, `${trackId}.jpg`), pic.data);
        }
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
    let query = reqUrl.searchParams.get("title");
    if (!query) {
      try {
        const cachePath = path.join(process.cwd(), "public", "drive_playlist_cache.json");
        if (fs.existsSync(cachePath)) {
          const list = JSON.parse(fs.readFileSync(cachePath, "utf8"));
          const found = list.find((t: any) => t.id === trackId);
          if (found) query = found.title;
        }
      } catch (e) {}
    }

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
