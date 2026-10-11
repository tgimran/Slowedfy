import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";
import { URL } from "url";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS & Media streaming headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, Pragma, Cache-Control");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "", "http://localhost");
  const fileId = reqUrl.searchParams.get("id");
  const isDownload = reqUrl.searchParams.get("download") === "true" || reqUrl.searchParams.get("dl") === "1";
  const filename = reqUrl.searchParams.get("filename") || `${fileId}.mp3`;

  if (!fileId || typeof fileId !== "string" || !/^[a-zA-Z0-9_-]{20,}$/.test(fileId)) {
    res.statusCode = 400;
    res.end("Invalid file ID");
    return;
  }

  const targetUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  const rangeHeader = req.headers.range;

  const requestHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
  };
  if (rangeHeader) {
    requestHeaders["Range"] = rangeHeader;
  }

  const streamFromUrl = (currentUrl: string, redirectsRemaining = 5) => {
    try {
      const parsedUrl = new URL(currentUrl);
      const transport = parsedUrl.protocol === "http:" ? http : https;

      const driveReq = transport.get(currentUrl, { headers: requestHeaders }, (driveRes) => {
        if (driveRes.statusCode && driveRes.statusCode >= 300 && driveRes.statusCode < 400 && driveRes.headers.location && redirectsRemaining > 0) {
          const nextUrl = new URL(driveRes.headers.location, currentUrl).href;
          driveRes.resume();
          return streamFromUrl(nextUrl, redirectsRemaining - 1);
        }

        const statusCode = driveRes.statusCode || 200;
        if (statusCode >= 400 && currentUrl.includes("drive.usercontent.google.com") && redirectsRemaining > 0) {
          driveRes.resume();
          return streamFromUrl(`https://drive.google.com/uc?export=download&id=${fileId}`, redirectsRemaining - 1);
        }

        res.statusCode = statusCode;

        const forwardHeaders = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified"];
        for (const h of forwardHeaders) {
          if (driveRes.headers[h]) {
            res.setHeader(h, driveRes.headers[h] as string);
          }
        }

        if (isDownload) {
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
        }
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");

        driveRes.pipe(res);
      });

      driveReq.setTimeout(12000, () => {
        driveReq.destroy();
        if (!res.headersSent) {
          res.statusCode = 504;
          res.end("Gateway timeout");
        }
      });

      driveReq.on("error", (err) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.end("Streaming error: " + err.message);
        }
      });

      req.on("close", () => {
        driveReq.destroy();
      });
    } catch (e: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal error: " + (e?.message || e));
      }
    }
  };

  streamFromUrl(targetUrl);
}
