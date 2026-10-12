import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

// Maximum stream chunk size (2 MB) - perfectly stays below Vercel's 4.5 MB payload limit while ensuring instant buffer playback
const MAX_CHUNK_BYTES = 2097152;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Global CORS & media streaming headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, Pragma, Cache-Control");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const fileId = reqUrl.searchParams.get("id");
  const isDownload = reqUrl.searchParams.get("download") === "true" || reqUrl.searchParams.get("dl") === "1";
  const customFilename = reqUrl.searchParams.get("filename") || `${fileId}.mp3`;

  if (!fileId || typeof fileId !== "string" || !/^[a-zA-Z0-9_-]{15,}$/.test(fileId)) {
    res.statusCode = 400;
    res.end("Invalid file ID");
    return;
  }

  // 1. Check local audio cache on disk
  const localCachePath = path.join(process.cwd(), "public", "audio_cache", `${fileId}.mp3`);
  const distCachePath = path.join(process.cwd(), "dist", "audio_cache", `${fileId}.mp3`);
  const cachedPath = (fs.existsSync(localCachePath) && fs.statSync(localCachePath).size > 50000)
    ? localCachePath
    : ((fs.existsSync(distCachePath) && fs.statSync(distCachePath).size > 50000) ? distCachePath : null);

  if (cachedPath) {
    try {
      const stat = fs.statSync(cachedPath);
      const totalSize = stat.size;
      const range = req.headers.range;
      const contentType = cachedPath.endsWith(".oga") ? "audio/ogg" : "audio/mpeg";

      if (isDownload) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(customFilename)}"`);
      } else {
        res.setHeader("Content-Disposition", "inline");
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        if (end - start + 1 > MAX_CHUNK_BYTES) {
          end = start + MAX_CHUNK_BYTES - 1;
        }
        if (end >= totalSize) end = totalSize - 1;
        const chunkSize = end - start + 1;

        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        res.setHeader("Content-Length", chunkSize);

        const stream = fs.createReadStream(cachedPath, { start, end });
        stream.pipe(res);
        return;
      } else {
        // Clamp chunk for initial playback
        const end = Math.min(MAX_CHUNK_BYTES - 1, totalSize - 1);
        const chunkSize = end + 1;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes 0-${end}/${totalSize}`);
        res.setHeader("Content-Length", chunkSize);

        const stream = fs.createReadStream(cachedPath, { start: 0, end });
        stream.pipe(res);
        return;
      }
    } catch (e) {}
  }

  // 2. Stream directly from Google Drive with smart Range chunking & redirect resolution
  const targetUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  const rawRange = req.headers.range;

  let requestRange = "bytes=0-2097151"; // Default 2MB initial chunk
  if (rawRange) {
    const parts = rawRange.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10) || 0;
    let end = parts[1] ? parseInt(parts[1], 10) : start + MAX_CHUNK_BYTES - 1;
    if (end - start + 1 > MAX_CHUNK_BYTES) {
      end = start + MAX_CHUNK_BYTES - 1;
    }
    requestRange = `bytes=${start}-${end}`;
  }

  const requestHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "identity",
    "Range": requestRange,
  };

  const streamFromUrl = (currentUrl: string, redirectsRemaining = 5) => {
    try {
      const parsedUrl = new URL(currentUrl);
      const transport = parsedUrl.protocol === "http:" ? http : https;

      const driveReq = transport.get(currentUrl, { headers: requestHeaders }, (driveRes) => {
        // Handle HTTP redirects (301, 302, 303, 307)
        if (driveRes.statusCode && driveRes.statusCode >= 300 && driveRes.statusCode < 400 && driveRes.headers.location && redirectsRemaining > 0) {
          const nextUrl = driveRes.headers.location.startsWith("http")
            ? driveRes.headers.location
            : new URL(driveRes.headers.location, parsedUrl.origin).href;
          driveRes.resume();
          return streamFromUrl(nextUrl, redirectsRemaining - 1);
        }

        const statusCode = driveRes.statusCode || 200;
        // Fallback endpoint if usercontent returns error
        if (statusCode >= 400 && currentUrl.includes("drive.usercontent.google.com") && redirectsRemaining > 0) {
          driveRes.resume();
          return streamFromUrl(`https://drive.google.com/uc?export=download&id=${fileId}`, redirectsRemaining - 1);
        }

        res.statusCode = statusCode === 200 && driveRes.headers["content-range"] ? 206 : statusCode;

        // Forward critical streaming headers from Drive
        const forwardHeaders = ["content-range", "content-length", "accept-ranges", "last-modified", "etag"];
        for (const h of forwardHeaders) {
          if (driveRes.headers[h]) {
            res.setHeader(h, driveRes.headers[h] as string);
          }
        }

        // Determine proper audio MIME type
        const driveMime = driveRes.headers["content-type"];
        let finalMime = "audio/mpeg";
        if (customFilename.toLowerCase().endsWith(".oga") || driveMime?.includes("ogg")) {
          finalMime = "audio/ogg";
        }
        res.setHeader("Content-Type", finalMime);
        res.setHeader("Accept-Ranges", "bytes");

        // Force inline streaming disposition (NEVER attachment unless user requested download)
        if (isDownload) {
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(customFilename)}"`);
        } else {
          res.setHeader("Content-Disposition", "inline");
        }

        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

        driveRes.pipe(res);
      });

      driveReq.setTimeout(18000, () => {
        driveReq.destroy();
        if (!res.headersSent) {
          res.statusCode = 504;
          res.end("Gateway timeout");
        }
      });

      driveReq.on("error", (err) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.end("Stream error: " + err.message);
        }
      });

      req.on("close", () => {
        driveReq.destroy();
      });
    } catch (e: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Stream internal error: " + (e?.message || e));
      }
    }
  };

  streamFromUrl(targetUrl);
}
