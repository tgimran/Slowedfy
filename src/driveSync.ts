import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";
import type { PlaylistItem } from "./defaultPlaylist.ts";
import {
  OFFICIAL_PLAYLIST,
  DEFAULT_DRIVE_FOLDER_ID,
  AESTHETIC_ARTWORKS,
} from "./defaultPlaylist.ts";

const execPromise = util.promisify(exec);
const COVERS_DIR = path.join(process.cwd(), "public", "covers");
const THUMBS_DIR = path.join(COVERS_DIR, "thumbs");
const AUDIO_CACHE_DIR = path.join(process.cwd(), "public", "audio_cache");
const DIST_COVERS_DIR = path.join(process.cwd(), "dist", "covers");
const DIST_THUMBS_DIR = path.join(DIST_COVERS_DIR, "thumbs");

if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
if (fs.existsSync(path.join(process.cwd(), "dist"))) {
  if (!fs.existsSync(DIST_COVERS_DIR)) fs.mkdirSync(DIST_COVERS_DIR, { recursive: true });
  if (!fs.existsSync(DIST_THUMBS_DIR)) fs.mkdirSync(DIST_THUMBS_DIR, { recursive: true });
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/**
 * Preserve the exact Drive filename as the website song title,
 * removing ONLY the audio file extension (.mp3, .oga, etc.).
 * Preserves spaces, casing, numbers, brackets, hyphens, underscores and symbols.
 */
export function getDisplayedTitle(rawName: string): string {
  if (!rawName) return "Unknown Song";
  return rawName
    .replace(/\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/gi, "")
    .replace(/\.mp3$/gi, "")
    .trim();
}

/**
 * Extract artist information from the filename when present, or fallback to "Slowedfy".
 */
export function extractArtist(rawName: string): string {
  const clean = getDisplayedTitle(rawName);
  const byMatch = clean.match(/By\s+([^()]+)/i);
  if (byMatch) return byMatch[1].trim();

  const pipeParts = clean.split(/[│｜|]/).map((s) => s.trim());
  if (pipeParts.length >= 2) return pipeParts[1];

  const dashMatch = clean.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();

  return "Slowedfy";
}

export interface SkippedFileDetail {
  id: string;
  name: string;
  reason: string;
}

export interface SyncSummary {
  totalDriveFilesDiscovered: number;
  totalValidAudioFiles: number;
  totalFilesInSubfolders: number;
  totalAlreadyImported: number;
  totalNewlyImported: number;
  totalUpdated: number;
  totalDuplicates: number;
  totalSkipped: number;
  skippedFilesDetails: SkippedFileDetail[];
  finalWebsiteSongs: number;
  syncedAt: string;
}

let cachedDrivePlaylist: PlaylistItem[] = [...OFFICIAL_PLAYLIST];
try {
  const diskCacheFile = path.join(process.cwd(), "public", "drive_playlist_cache.json");
  if (fs.existsSync(diskCacheFile)) {
    const raw = fs.readFileSync(diskCacheFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length >= OFFICIAL_PLAYLIST.length) {
      cachedDrivePlaylist = parsed;
    }
  }
} catch (e) {}

let lastSyncTimestamp = Date.now();
let lastSyncSummary: SyncSummary = {
  totalDriveFilesDiscovered: cachedDrivePlaylist.length,
  totalValidAudioFiles: cachedDrivePlaylist.length,
  totalFilesInSubfolders: 0,
  totalAlreadyImported: cachedDrivePlaylist.length,
  totalNewlyImported: 0,
  totalUpdated: 0,
  totalDuplicates: 0,
  totalSkipped: 0,
  skippedFilesDetails: [],
  finalWebsiteSongs: cachedDrivePlaylist.length,
  syncedAt: new Date().toISOString(),
};

export function getCachedDrivePlaylist(): PlaylistItem[] {
  return cachedDrivePlaylist;
}

export function getLastSyncTime(): number {
  return lastSyncTimestamp;
}

export function getLastSyncSummary(): SyncSummary {
  return lastSyncSummary;
}

type SyncUpdateListener = (playlist: PlaylistItem[], totalNew: number, totalUpdated: number) => void;
const syncListeners: SyncUpdateListener[] = [];

export function registerSyncUpdateListener(listener: SyncUpdateListener) {
  syncListeners.push(listener);
}

function notifySyncListeners(playlist: PlaylistItem[], totalNew: number, totalUpdated: number) {
  for (const listener of syncListeners) {
    try {
      listener(playlist, totalNew, totalUpdated);
    } catch (e) {}
  }
}

export function fetchHtml(url: string, redirectsRemaining = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(e);
    }

    if (!parsed.searchParams.has("_t")) {
      parsed.searchParams.set("_t", Date.now().toString());
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      parsed.toString(),
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsRemaining > 0
        ) {
          const nextUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, parsed.origin).href;
          return fetchHtml(nextUrl, redirectsRemaining - 1).then(resolve).catch(reject);
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
      reject(new Error("Drive request timeout"));
    });
  });
}

/**
 * Downloads a file or partial stream to a local path, following HTTP redirects.
 */
function downloadFileStream(url: string, destPath: string, maxBytes = 0): Promise<boolean> {
  return new Promise((resolve) => {
    const tmpPath = destPath + ".tmp_" + Date.now();
    const fileStream = fs.createWriteStream(tmpPath);
    let bytesWritten = 0;

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          ...(maxBytes > 0 ? { Range: `bytes=0-${maxBytes}` } : {}),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fileStream.close();
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
          return downloadFileStream(res.headers.location, destPath, maxBytes).then(resolve);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          fileStream.close();
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
          return resolve(false);
        }

        res.on("data", (chunk) => {
          bytesWritten += chunk.length;
          fileStream.write(chunk);
          if (maxBytes > 0 && bytesWritten >= maxBytes) {
            res.destroy();
            fileStream.end();
          }
        });

        res.on("end", () => {
          fileStream.end();
        });

        fileStream.on("finish", () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 1000) {
                fs.renameSync(tmpPath, destPath);
                resolve(true);
              } else {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                resolve(false);
              }
            } catch (e) {
              resolve(false);
            }
          });
        });
      }
    );

    req.on("error", () => {
      fileStream.close();
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
      resolve(false);
    });
    req.setTimeout(12000, () => {
      req.destroy();
      fileStream.close();
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
      resolve(false);
    });
  });
}

// Fetch byte range from URL directly into Buffer (defaults to 10MB to cover high-res 3264x3264 embedded art)
export function downloadFileRange(url: string, maxBytes = 10000000, redirectsRemaining = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const client = parsed.protocol === "http:" ? http : https;
    let timer: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Range": `bytes=0-${maxBytes}`,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsRemaining > 0) {
          cleanup();
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, parsed.origin).href;
          res.resume();
          return downloadFileRange(next, maxBytes, redirectsRemaining - 1).then(resolve).catch(reject);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= maxBytes) {
            if (!resolved) {
              resolved = true;
              cleanup();
              try { req.destroy(); } catch (e) {}
              try { res.destroy(); } catch (e) {}
              resolve(Buffer.concat(chunks));
            }
          }
        });
        res.on("end", () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            try { req.destroy(); } catch (e) {}
            resolve(Buffer.concat(chunks));
          }
        });
      }
    );
    req.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });
    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        try { req.destroy(); } catch (e) {}
        reject(new Error("Timeout"));
      }
    }, 15000);
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

    if (frameSize > 500 && frameSize < 20000000) {
      const frameData = buf.slice(dataOffset, Math.min(dataOffset + frameSize, buf.length));
      // 1. Look for JPEG start marker
      const jpgStart = frameData.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      if (jpgStart !== -1) {
        const lastJpgEnd = frameData.lastIndexOf(Buffer.from([0xff, 0xd9]));
        if (lastJpgEnd > jpgStart && lastJpgEnd - jpgStart > 2000) {
          const img = frameData.slice(jpgStart, lastJpgEnd + 2);
          return { mime: "image/jpeg", data: img };
        }
      }
      // 2. Look for PNG start marker
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const pngStart = frameData.indexOf(pngHeader);
      if (pngStart !== -1) {
        const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
        const pngEnd = frameData.indexOf(iend, pngStart);
        if (pngEnd !== -1 && pngEnd - pngStart > 2000) {
          const img = frameData.slice(pngStart, pngEnd + 8);
          return { mime: "image/png", data: img };
        }
      }
    }
  }

  // Generic fallback if APIC header was non-standard: find JPEG magic bytes anywhere in buffer
  const jpgStart = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (jpgStart !== -1 && jpgStart < buf.length - 2000) {
    const lastJpgEnd = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (lastJpgEnd > jpgStart && lastJpgEnd - jpgStart > 2000) {
      return { mime: "image/jpeg", data: buf.slice(jpgStart, lastJpgEnd + 2) };
    }
  }

  // Generic fallback for PNG magic bytes
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngStart = buf.indexOf(pngHeader);
  if (pngStart !== -1 && pngStart < buf.length - 2000) {
    const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const pngEnd = buf.lastIndexOf(iend);
    if (pngEnd > pngStart && pngEnd - pngStart > 2000) {
      return { mime: "image/png", data: buf.slice(pngStart, pngEnd + 8) };
    }
  }

  return null;
}

/**
 * Searches Apple iTunes Search API (free, reliable, instant, official 1000x1000 covers).
 */
export async function fetchItunesCover(title: string, artist?: string): Promise<string | null> {
  try {
    const cleanTitle = title
      .replace(/\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[│｜|]/g, " ")
      .replace(/Slowed\s*\+?\s*Reverb/gi, "")
      .replace(/By\s+.*$/i, "")
      .replace(/Extended\s*Version/gi, "")
      .trim();

    const queryArtist = artist && artist !== "Slowedfy" ? artist.replace(/Beat Badge/gi, "").trim() : "";
    const query = encodeURIComponent(`${queryArtist} ${cleanTitle}`.trim());
    const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;

    return new Promise((resolve) => {
      https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.results && json.results.length > 0 && json.results[0].artworkUrl100) {
              const highRes = json.results[0].artworkUrl100.replace("100x100bb", "1000x1000bb");
              resolve(highRes);
              return;
            }
          } catch (e) {}
          resolve(null);
        });
      }).on("error", () => resolve(null));
    });
  } catch (err) {
    return null;
  }
}

/**
 * Copy file to dist directory if dist exists (so production bundle stays synced)
 */
function syncFileToDist(srcFile: string, distDir: string, filename: string) {
  try {
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }
    const dest = path.join(distDir, filename);
    fs.copyFileSync(srcFile, dest);
  } catch (e) {}
}

const inFlightCoverExtractions = new Map<string, Promise<{ success: boolean; cover: string; thumb: string }>>();

/**
 * Extract embedded APIC / Attached Picture from audio, companion Drive image, or iTunes API.
 * Guarantees that every track gets high-resolution square artwork and thumbnail.
 * Includes concurrency deduplication to prevent redundant extractions.
 */
export async function extractEmbeddedCoverForTrack(
  trackId: string,
  trackTitle = "",
  trackArtist = "",
  companionImageId?: string
): Promise<{ success: boolean; cover: string; thumb: string }> {
  const existingPromise = inFlightCoverExtractions.get(trackId);
  if (existingPromise) {
    return existingPromise;
  }

  const extractionPromise = doExtractEmbeddedCoverForTrack(trackId, trackTitle, trackArtist, companionImageId);
  inFlightCoverExtractions.set(trackId, extractionPromise);

  try {
    return await extractionPromise;
  } finally {
    inFlightCoverExtractions.delete(trackId);
  }
}

async function doExtractEmbeddedCoverForTrack(
  trackId: string,
  trackTitle = "",
  trackArtist = "",
  companionImageId?: string
): Promise<{ success: boolean; cover: string; thumb: string }> {
  const coverPath = path.join(COVERS_DIR, `${trackId}.jpg`);
  const thumbPath = path.join(THUMBS_DIR, `${trackId}.jpg`);
  const distCoverPath = path.join(DIST_COVERS_DIR, `${trackId}.jpg`);
  const distThumbPath = path.join(DIST_THUMBS_DIR, `${trackId}.jpg`);

  // Check public directory
  let hasCover = fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000;
  let hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500;

  // Check dist directory if missing in public
  if (!hasCover && fs.existsSync(distCoverPath) && fs.statSync(distCoverPath).size > 1000) {
    try {
      fs.copyFileSync(distCoverPath, coverPath);
      hasCover = true;
    } catch (e) {}
  }
  if (!hasThumb && fs.existsSync(distThumbPath) && fs.statSync(distThumbPath).size > 500) {
    try {
      fs.copyFileSync(distThumbPath, thumbPath);
      hasThumb = true;
    } catch (e) {}
  }

  if (hasCover && hasThumb) {
    syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
    syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
    return {
      success: true,
      cover: `/covers/${trackId}.jpg`,
      thumb: `/covers/thumbs/${trackId}.jpg`,
    };
  }

  // 1. FAST LOCAL EXTRACTION: If audio file exists on disk, extract embedded art via ffmpeg with 0ms network latency
  const localAudioPath = path.join(AUDIO_CACHE_DIR, `${trackId}.mp3`);
  const distAudioPath = path.join(process.cwd(), "dist", "audio_cache", `${trackId}.mp3`);
  const existingAudio = (fs.existsSync(localAudioPath) && fs.statSync(localAudioPath).size > 50000)
    ? localAudioPath
    : ((fs.existsSync(distAudioPath) && fs.statSync(distAudioPath).size > 50000) ? distAudioPath : null);

  if (existingAudio) {
    try {
      const cmd = `ffmpeg -y -v error -i "${existingAudio}" -an -vcodec copy "${coverPath}"`;
      await execPromise(cmd, { timeout: 10000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        try {
          const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=200:200:flags=lanczos" "${thumbPath}"`;
          await execPromise(thumbCmd, { timeout: 8000 });
        } catch (eTh) {
          fs.copyFileSync(coverPath, thumbPath);
        }
        syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
        syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
        console.log(`[DriveSync] 🎨 Fast ffmpeg extraction from cached MP3 for ${trackId}`);
        return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
      }
    } catch (eFfmpeg) {
      try {
        const transcodeCmd = `ffmpeg -y -v error -i "${existingAudio}" -an -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080:flags=lanczos" "${coverPath}"`;
        await execPromise(transcodeCmd, { timeout: 10000 });
        if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
          try {
            const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=200:200:flags=lanczos" "${thumbPath}"`;
            await execPromise(thumbCmd, { timeout: 8000 });
          } catch (eTh) {
            fs.copyFileSync(coverPath, thumbPath);
          }
          syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
          syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
          return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
        }
      } catch (eTrans) {}
    }

    try {
      const buf = fs.readFileSync(existingAudio);
      const pic = extractId3Picture(buf);
      if (pic && pic.data && pic.data.length > 2000) {
        fs.writeFileSync(coverPath, pic.data);
        try {
          const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=200:200:flags=lanczos" "${thumbPath}"`;
          await execPromise(thumbCmd, { timeout: 6000 });
        } catch (eTh) {
          fs.writeFileSync(thumbPath, pic.data);
        }
        syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
        syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
        return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
      }
    } catch (eBuf) {}
  }

  // 2. If companion image uploaded in Google Drive folder, download directly
  if (companionImageId) {
    const driveImgUrl = `https://drive.usercontent.google.com/download?id=${companionImageId}&export=download`;
    const tempImg = path.join(COVERS_DIR, `temp_${trackId}.img`);
    const downloaded = await downloadFileStream(driveImgUrl, tempImg);
    if (downloaded) {
      try {
        const cropCmd = `ffmpeg -y -v error -i "${tempImg}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
        await execPromise(cropCmd, { timeout: 10000 });
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 10000 });
        try { fs.unlinkSync(tempImg); } catch (e) {}
        if (fs.existsSync(coverPath) && fs.existsSync(thumbPath)) {
          syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
          syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
          return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
        }
      } catch (e) {}
    }
  }

  // 3. Pure Node.js direct ID3 APIC extraction from Google Drive stream (downloads up to 10MB to cover high-res art)
  const driveAudioUrl = `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;
  try {
    const buf = await downloadFileRange(driveAudioUrl, 10000000);
    const pic = extractId3Picture(buf);
    if (pic && pic.data && pic.data.length > 2000) {
      fs.writeFileSync(coverPath, pic.data);
      try {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=200:200:flags=lanczos" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 6000 });
      } catch (eTh) {
        fs.writeFileSync(thumbPath, pic.data);
      }
      syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
      syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
      console.log(`[DriveSync] 🎨 Auto-extracted embedded ID3 artwork for ${trackId} (${(pic.data.length / 1024).toFixed(1)} KB)`);
      return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
    }
  } catch (eAp) {}

  // 4. Download first 10MB of audio file from Drive and extract embedded cover with ffmpeg
  const tempAudioPath = path.join(AUDIO_CACHE_DIR, `part_${trackId}.mp3`);
  const gotPartial = await downloadFileStream(driveAudioUrl, tempAudioPath, 10000000);

  if (gotPartial) {
    try {
      const cmd = `ffmpeg -y -v error -i "${tempAudioPath}" -an -vcodec copy "${coverPath}"`;
      await execPromise(cmd, { timeout: 10000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 10000 });
        try { fs.unlinkSync(tempAudioPath); } catch (e) {}
        syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
        syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
        return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
      }
    } catch (e) {
      try {
        const cmd = `ffmpeg -y -v error -i "${tempAudioPath}" -an -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
        await execPromise(cmd, { timeout: 10000 });
        if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
          const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
          await execPromise(thumbCmd, { timeout: 10000 });
          try { fs.unlinkSync(tempAudioPath); } catch (e) {}
          syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
          syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
          return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
        }
      } catch (e2) {}
    }
    try { if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath); } catch (e) {}
  }

  // 5. Query Apple iTunes Search API for official 1000x1000 album artwork
  if (trackTitle) {
    const itunesUrl = await fetchItunesCover(trackTitle, trackArtist);
    if (itunesUrl) {
      const tempItunesImg = path.join(COVERS_DIR, `itunes_${trackId}.jpg`);
      const downloaded = await downloadFileStream(itunesUrl, tempItunesImg);
      if (downloaded) {
        try {
          const cropCmd = `ffmpeg -y -v error -i "${tempItunesImg}" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
          await execPromise(cropCmd, { timeout: 10000 });
          const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
          await execPromise(thumbCmd, { timeout: 10000 });
          try { fs.unlinkSync(tempItunesImg); } catch (e) {}
          if (fs.existsSync(coverPath) && fs.existsSync(thumbPath)) {
            syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
            syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
            return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
          }
        } catch (e) {}
      }
    }
  }

  // 6. High-quality curated aesthetic cover fallback
  const fallback = AESTHETIC_ARTWORKS[0];
  return { success: false, cover: fallback, thumb: fallback };
}

export interface RawDriveFile {
  id: string;
  name: string;
  mime: string;
  uploadTime: number;
  modTime: number;
  bytes: number;
  isFolder?: boolean;
}

/**
 * Parses Google Drive items from HTML responses.
 * Scans both window['_DRIVE_ivd'] and all embedded AF_initDataCallback structures.
 */
function parseDriveItemsFromHtml(html: string): RawDriveFile[] {
  const items: RawDriveFile[] = [];
  const seenIds = new Set<string>();

  // 1. window['_DRIVE_ivd'] (both single and double quote formats)
  const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
  if (ivdMatch) {
    try {
      const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
      const parsed = JSON.parse(unescaped);
      const addRow = (node: any) => {
        if (!node || !Array.isArray(node) || node.length < 4) return;
        const id = node[0];
        const name = node[2];
        const mime = node[3] || "audio/mpeg";
        const uploadTime = Number(node[9]) || Number(node[10]) || 0;
        const modTime = Number(node[10]) || 0;
        const bytes = Number(node[13]) || Number(node[27]) || 0;
        const isFolder = mime === "application/vnd.google-apps.folder" || String(mime).includes("folder");

        if (
          typeof id === "string" &&
          /^[a-zA-Z0-9_-]{20,}$/.test(id) &&
          typeof name === "string" &&
          !seenIds.has(id)
        ) {
          seenIds.add(id);
          items.push({ id, name, mime, uploadTime, modTime, bytes, isFolder });
        }
      };

      const walkNode = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          if (node.length >= 4 && typeof node[0] === "string" && /^[a-zA-Z0-9_-]{20,}$/.test(node[0]) && typeof node[2] === "string") {
            addRow(node);
          }
          for (const child of node) {
            walkNode(child);
          }
        }
      };
      walkNode(parsed);
    } catch (e) {}
  }

  // 2. Parse all AF_initDataCallback blocks (e.g. ds:4, ds:0 etc)
  try {
    const afMatches = html.matchAll(/AF_initDataCallback\s*\(\s*(\{.*?key\s*:\s*['"]ds:\d+['"].*?\})\s*\)\s*;/gs);
    for (const m of afMatches) {
      try {
        const fn = new Function("return " + m[1]);
        const obj = fn();
        if (obj && obj.data) {
          const walkData = (node: any) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
              if (
                node.length >= 4 &&
                typeof node[0] === "string" &&
                /^[a-zA-Z0-9_-]{25,}$/.test(node[0]) &&
                typeof node[2] === "string" &&
                /\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma|jpe?g|png|webp|jfif|bmp)$/i.test(node[2])
              ) {
                const id = node[0];
                const name = node[2];
                const mime = node[3] || "audio/mpeg";
                const uploadTime = Number(node[9]) || 0;
                const modTime = Number(node[10]) || 0;
                const bytes = Number(node[13]) || 0;
                const isFolder = mime === "application/vnd.google-apps.folder" || mime.includes("folder");
                if (!seenIds.has(id)) {
                  seenIds.add(id);
                  items.push({ id, name, mime, uploadTime, modTime, bytes, isFolder });
                }
              }
              for (const child of node) {
                walkData(child);
              }
            }
          };
          walkData(obj.data);
        }
      } catch (e2) {}
    }
  } catch (e) {}

  return items;
}

/**
 * Scans a folder recursively across multiple sort and direction views in parallel.
 * Puts sort=14&dir=d (Upload date descending) and sort=11&dir=d (Modified date descending) FIRST
 * so ANY newly uploaded track is discovered immediately in the fastest possible query batch!
 */
export async function scanFolderFiles(folderId: string): Promise<{
  audioFiles: RawDriveFile[];
  imageFiles: RawDriveFile[];
  subfolderCount: number;
}> {
  const queryUrls = [
    `https://drive.google.com/drive/folders/${folderId}?sort=14&dir=d`, // Upload time descending (NEWEST UPLOADS FIRST)
    `https://drive.google.com/drive/folders/${folderId}?sort=11&dir=d`, // Modified time descending
    `https://drive.google.com/drive/folders/${folderId}?sort=13&dir=d`, // Last opened descending
    `https://drive.google.com/drive/folders/${folderId}?sort=14`,       // Upload time ascending
    `https://drive.google.com/drive/folders/${folderId}?sort=11`,       // Modified time ascending
    `https://drive.google.com/drive/folders/${folderId}?sort=1&dir=d`,  // Name descending
    `https://drive.google.com/drive/folders/${folderId}?sort=1`,        // Name ascending
    `https://drive.google.com/drive/folders/${folderId}?sort=7&dir=d`,  // Size descending
    `https://drive.google.com/drive/folders/${folderId}?sort=7`,        // Size ascending
    `https://drive.google.com/drive/folders/${folderId}?sort=3`,        // Last modified by me
  ];

  const allDiscovered = new Map<string, RawDriveFile>();
  const subfolders: string[] = [];

  const fetchPromises = queryUrls.map(async (u) => {
    try {
      const html = await fetchHtml(u);
      return parseDriveItemsFromHtml(html);
    } catch (err) {
      return [];
    }
  });

  const results = await Promise.allSettled(fetchPromises);
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const it of r.value) {
        if (!allDiscovered.has(it.id)) {
          allDiscovered.set(it.id, it);
          if (it.isFolder) {
            subfolders.push(it.id);
          }
        }
      }
    }
  }

  // Recursive scan for any subfolders found
  let subfolderCount = subfolders.length;
  for (const subId of subfolders) {
    try {
      const subResult = await scanFolderFiles(subId);
      subfolderCount += subResult.subfolderCount;
      for (const subFile of subResult.audioFiles) {
        if (!allDiscovered.has(subFile.id)) {
          allDiscovered.set(subFile.id, subFile);
        }
      }
      for (const subImg of subResult.imageFiles) {
        if (!allDiscovered.has(subImg.id)) {
          allDiscovered.set(subImg.id, subImg);
        }
      }
    } catch (err) {
      console.warn(`[DriveSync] Error recursively scanning subfolder ${subId}:`, err);
    }
  }

  const allFiles = Array.from(allDiscovered.values()).filter((f) => !f.isFolder);
  const audioFiles: RawDriveFile[] = [];
  const imageFiles: RawDriveFile[] = [];

  for (const f of allFiles) {
    const isAudioExt = /\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/i.test(f.name);
    const isAudioMime = f.mime?.startsWith("audio/") || f.mime === "application/octet-stream";
    const isImageExt = /\.(jpe?g|png|webp|jfif|bmp)$/i.test(f.name);
    const isImageMime = f.mime?.startsWith("image/");

    if (isAudioExt || isAudioMime) {
      audioFiles.push(f);
    } else if (isImageExt || isImageMime) {
      imageFiles.push(f);
    }
  }

  return { audioFiles, imageFiles, subfolderCount };
}

export async function probeAndSyncTrackDuration(track: PlaylistItem): Promise<void> {
  try {
    const inputUrl = `https://drive.usercontent.google.com/download?id=${track.id}&export=download`;
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputUrl}"`,
      { timeout: 8000 }
    );
    const sec = Math.round(parseFloat(stdout.trim()));
    if (sec > 0) {
      track.seconds = sec;
      track.duration = formatTime(sec);
      console.log(`[DriveSync] Accurate duration probed for track "${track.title}": ${track.duration} (${sec}s)`);
    }
  } catch (e) {}
}

/**
 * Check if an image filename corresponds to a given audio track
 */
function isCompanionImage(imgName: string, songName: string): boolean {
  const cleanImg = imgName.toLowerCase().replace(/\.(jpe?g|png|webp|jfif|bmp)$/i, "").trim();
  const cleanSong = songName.toLowerCase().replace(/\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/i, "").trim();
  if (cleanImg === cleanSong) return true;
  if (cleanImg.includes(cleanSong) || cleanSong.includes(cleanImg)) return true;
  if (["cover", "folder", "album", "artwork", "thumb"].includes(cleanImg)) return true;
  return false;
}

let activeSyncPromise: Promise<PlaylistItem[]> | null = null;

export async function syncGoogleDriveFolder(
  folderId: string = DEFAULT_DRIVE_FOLDER_ID
): Promise<PlaylistItem[]> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  activeSyncPromise = doSyncGoogleDriveFolder(folderId).finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

/**
 * Synchronize Google Drive folder completely:
 * - Detects all songs and companion album art files
 * - Automatically processes and saves high-definition cover art
 * - Accurately probes duration
 * - Sorts newest uploaded song first
 * - Incremental sync with INSTANT real-time live notification
 */
async function doSyncGoogleDriveFolder(
  folderId: string = DEFAULT_DRIVE_FOLDER_ID
): Promise<PlaylistItem[]> {
  try {
    const { audioFiles, imageFiles, subfolderCount } = await scanFolderFiles(folderId);

    const validAudios: RawDriveFile[] = [...audioFiles];
    const skippedFiles: SkippedFileDetail[] = [];

    // Sort newest uploaded first
    validAudios.sort((a, b) => {
      const timeA = a.uploadTime || a.modTime || 0;
      const timeB = b.uploadTime || b.modTime || 0;
      if (timeB !== timeA) return timeB - timeA;
      return a.name.localeCompare(b.name);
    });

    const existingMap = new Map<string, PlaylistItem>(
      cachedDrivePlaylist.map((t) => [t.id, t])
    );

    let totalNew = 0;
    let totalUpdated = 0;
    const newlyDetectedTracks: PlaylistItem[] = [];

    validAudios.forEach((f) => {
      const existing = existingMap.get(f.id);
      const title = getDisplayedTitle(f.name);
      const artist = extractArtist(f.name);
      const format = f.name.endsWith(".oga") ? "OGG" : "MP3";

      let sizeStr = existing?.size || "5.0 MB";
      let durationSec = existing?.seconds || 240;
      let durationFormatted = existing?.duration || "04:00";

      // Priority 1: Check existing tracked metadata if valid
      if (existing?.seconds && existing.seconds > 10 && existing.duration && !existing.duration.includes(":60")) {
        durationSec = existing.seconds;
        durationFormatted = existing.duration;
      } else {
        // Priority 2: Check verified OFFICIAL_PLAYLIST
        const officialMatch = OFFICIAL_PLAYLIST.find((o) => o.id === f.id);
        if (officialMatch && officialMatch.seconds > 10 && officialMatch.duration && !officialMatch.duration.includes(":60")) {
          durationSec = officialMatch.seconds;
          durationFormatted = officialMatch.duration;
        } else if (f.bytes > 0) {
          durationSec = Math.round(f.bytes / 20000);
          if (durationSec < 60 || durationSec > 600) durationSec = 240;
          durationFormatted = formatTime(durationSec);
        }
      }

      if (f.bytes > 0) {
        const mb = (f.bytes / (1024 * 1024)).toFixed(1);
        sizeStr = `${mb} MB`;
      }

      const dateStr = f.uploadTime
        ? new Date(f.uploadTime).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : existing?.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

      const localCoverExists = fs.existsSync(path.join(COVERS_DIR, `${f.id}.jpg`));
      const localThumbExists = fs.existsSync(path.join(THUMBS_DIR, `${f.id}.jpg`));

      const thumb = localThumbExists
        ? `/covers/thumbs/${f.id}.jpg`
        : localCoverExists
        ? `/covers/${f.id}.jpg`
        : existing?.thumb || `/api/artwork?id=${f.id}&size=thumb`;

      const hdThumb = localCoverExists
        ? `/covers/${f.id}.jpg`
        : existing?.hdThumb || `/api/artwork?id=${f.id}`;

      // CRITICAL: Newly uploaded files MUST sort to the top!
      let uploadTime = Number(f.uploadTime) || Number(f.modTime) || 0;
      if (!uploadTime || uploadTime < 1000000000) {
        uploadTime = (!existing ? Date.now() : existing.uploadTime || Date.now());
      }

      const trackItem: PlaylistItem = {
        id: f.id,
        originalFilename: f.name,
        title,
        artist,
        album: "Slowed & Reverb Master Collection",
        duration: durationFormatted,
        seconds: durationSec,
        format,
        quality: "320 kbps HQ Audio",
        size: sizeStr,
        date: dateStr,
        uploadTime,
        streamUrl: `/api/stream?id=${f.id}`,
        driveUrl: `https://drive.usercontent.google.com/download?id=${f.id}&export=download`,
        thumb,
        hdThumb,
        isPremiere: false,
      };

      if (!existing) {
        totalNew++;
        newlyDetectedTracks.push(trackItem);
      } else {
        if (existing.originalFilename !== f.name || existing.title !== title) {
          totalUpdated++;
        }
      }

      existingMap.set(f.id, trackItem);
    });

    const updatedPlaylist = Array.from(existingMap.values());

    // Sort newest uploaded first
    updatedPlaylist.sort((a, b) => {
      const timeA = a.uploadTime || 0;
      const timeB = b.uploadTime || 0;
      if (timeB !== timeA) return timeB - timeA;
      return (a.originalFilename || a.title).localeCompare(b.originalFilename || b.title);
    });

    cachedDrivePlaylist = updatedPlaylist;
    lastSyncTimestamp = Date.now();

    lastSyncSummary = {
      totalDriveFilesDiscovered: audioFiles.length,
      totalValidAudioFiles: validAudios.length,
      totalFilesInSubfolders: subfolderCount,
      totalAlreadyImported: updatedPlaylist.length - totalNew,
      totalNewlyImported: totalNew,
      totalUpdated: totalUpdated,
      totalDuplicates: 0,
      totalSkipped: skippedFiles.length,
      skippedFilesDetails: skippedFiles,
      finalWebsiteSongs: updatedPlaylist.length,
      syncedAt: new Date().toISOString(),
    };

    // For newly detected tracks, immediately extract embedded artwork so it is ready on the website
    if (newlyDetectedTracks.length > 0) {
      await Promise.allSettled(
        newlyDetectedTracks.map(async (t) => {
          try {
            const companion = imageFiles.find((img) => isCompanionImage(img.name, t.originalFilename || t.title));
            const artRes = await extractEmbeddedCoverForTrack(t.id, t.title, t.artist, companion?.id);
            if (artRes.success) {
              t.thumb = artRes.thumb;
              t.hdThumb = artRes.cover;
            }
          } catch (e) {}
        })
      );
    }

    // CRITICAL: IF NEW TRACKS DETECTED, PERSIST & NOTIFY IMMEDIATELY!
    if (totalNew > 0 || totalUpdated > 0) {
      try {
        const cachePath = path.join(process.cwd(), "public", "drive_playlist_cache.json");
        fs.writeFileSync(cachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
        const distCachePath = path.join(process.cwd(), "dist", "drive_playlist_cache.json");
        if (fs.existsSync(path.join(process.cwd(), "dist"))) {
          fs.writeFileSync(distCachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
        }
      } catch (e) {}

      // NOTIFY ALL CLIENTS IMMEDIATELY OVER SSE (0 MILLISECOND DELAY)
      notifySyncListeners(cachedDrivePlaylist, totalNew, totalUpdated);
      console.log(`[DriveSync] ⚡ INSTANT LIVE SYNC: ${totalNew} new song(s) added immediately to website playlist!`);
    }

    // PROCESS ARTWORK & ACCURATE DURATION ASYNCHRONOUSLY IN BACKGROUND (NEVER BLOCKS LIVE PLAYLIST!)
    const tracksNeedingArtwork = updatedPlaylist.filter(t => {
      const coverP = path.join(COVERS_DIR, `${t.id}.jpg`);
      return !fs.existsSync(coverP) || fs.statSync(coverP).size < 1000;
    });
    const itemsToProcess = Array.from(new Set([...newlyDetectedTracks, ...tracksNeedingArtwork]));

    if (itemsToProcess.length > 0) {
      setImmediate(async () => {
        let metaChanged = false;
        for (const t of itemsToProcess) {
          try {
            const companion = imageFiles.find((img) => isCompanionImage(img.name, t.originalFilename || t.title));
            const artRes = await extractEmbeddedCoverForTrack(t.id, t.title, t.artist, companion?.id);
            if (artRes.success) {
              if (t.thumb !== artRes.thumb || t.hdThumb !== artRes.cover) {
                t.thumb = artRes.thumb;
                t.hdThumb = artRes.cover;
                metaChanged = true;
              }
            }
            if (!t.seconds || t.seconds === 240) {
              await probeAndSyncTrackDuration(t);
              metaChanged = true;
            }
          } catch (e) {}
        }

        if (metaChanged) {
          try {
            const cachePath = path.join(process.cwd(), "public", "drive_playlist_cache.json");
            fs.writeFileSync(cachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
            const distCachePath = path.join(process.cwd(), "dist", "drive_playlist_cache.json");
            if (fs.existsSync(path.join(process.cwd(), "dist"))) {
              fs.writeFileSync(distCachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
            }
          } catch (e) {}
          notifySyncListeners(cachedDrivePlaylist, 0, itemsToProcess.length);
        }
      });
    }

    console.log(
      `[DriveSync] Completed sync for ${folderId}: ${updatedPlaylist.length} tracks (New: ${totalNew}, Updated: ${totalUpdated})`
    );
    return cachedDrivePlaylist;
  } catch (err) {
    console.warn("[DriveSync] Automated sync failed, returning cached library:", err);
    return cachedDrivePlaylist;
  }
}

// Audio caching helper for zero-delay playback
export async function downloadAndCacheTrackAudio(trackId: string): Promise<boolean> {
  const destPath = path.join(AUDIO_CACHE_DIR, `${trackId}.mp3`);
  const distAudioDir = path.join(process.cwd(), "dist", "audio_cache");
  const distDestPath = path.join(distAudioDir, `${trackId}.mp3`);

  if (fs.existsSync(destPath)) {
    try {
      if (fs.statSync(destPath).size > 50000) {
        if (fs.existsSync(path.join(process.cwd(), "dist"))) {
          if (!fs.existsSync(distAudioDir)) fs.mkdirSync(distAudioDir, { recursive: true });
          if (!fs.existsSync(distDestPath)) {
            try { fs.copyFileSync(destPath, distDestPath); } catch (e) {}
          }
        }
        return true;
      }
    } catch (e) {}
  }
  const url = `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;
  const ok = await downloadFileStream(url, destPath);
  if (ok) {
    if (fs.existsSync(path.join(process.cwd(), "dist"))) {
      if (!fs.existsSync(distAudioDir)) fs.mkdirSync(distAudioDir, { recursive: true });
      try { fs.copyFileSync(destPath, distDestPath); } catch (e) {}
    }
    // Verify album art exists for this track; extract immediately from local cached audio if missing
    const coverPath = path.join(COVERS_DIR, `${trackId}.jpg`);
    if (!fs.existsSync(coverPath) || fs.statSync(coverPath).size < 1000) {
      extractEmbeddedCoverForTrack(trackId).catch(() => {});
    }
  }
  return ok;
}

let isPreloadingAudio = false;
export async function preloadTopTracksAudio(count = 20) {
  if (isPreloadingAudio) return;
  isPreloadingAudio = true;
  try {
    const tracks = cachedDrivePlaylist.slice(0, count);
    for (const t of tracks) {
      try {
        await downloadAndCacheTrackAudio(t.id);
      } catch (e) {}
    }
  } finally {
    isPreloadingAudio = false;
  }
}

/**
 * Progressively caches all tracks in the playlist in the background.
 * Ensures that every song in the master library plays instantly with 0ms delay.
 */
export async function cacheAllTracksInBackground() {
  if (isPreloadingAudio) return;
  isPreloadingAudio = true;
  try {
    const tracks = [...cachedDrivePlaylist];
    for (const t of tracks) {
      const destPath = path.join(AUDIO_CACHE_DIR, `${t.id}.mp3`);
      if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 50000) {
        try {
          await downloadAndCacheTrackAudio(t.id);
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  } finally {
    isPreloadingAudio = false;
  }
}

/**
 * Ultra-fast poll check (every 6 seconds):
 * Fetches the newest modified files view (sort=13&dir=d) from Google Drive.
 * If any file in this view is not in our cached playlist, immediately triggers full sync!
 */
let isFastChecking = false;
export async function fastCheckNewDriveUploads(): Promise<boolean> {
  if (isFastChecking || activeSyncPromise) return false;
  isFastChecking = true;
  try {
    const url = `https://drive.google.com/drive/folders/${DEFAULT_DRIVE_FOLDER_ID}?sort=14&dir=d`;
    const html = await fetchHtml(url);
    const items = parseDriveItemsFromHtml(html);
    const currentIds = new Set(cachedDrivePlaylist.map((t) => t.id));

    let foundNew = false;
    for (const it of items) {
      const isAudio = /\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/i.test(it.name) || it.mime?.startsWith("audio/");
      if (isAudio && !currentIds.has(it.id)) {
        foundNew = true;
        console.log(`[DriveSync] Fast-poll detected brand new upload in Drive: "${it.name}" (${it.id})! Syncing immediately...`);
        break;
      }
    }

    if (foundNew) {
      await syncGoogleDriveFolder(DEFAULT_DRIVE_FOLDER_ID);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  } finally {
    isFastChecking = false;
  }
}

// Background auto-polling timer: checks for new songs reliably
let fastSyncTimer: NodeJS.Timeout | null = null;
let fullSyncTimer: NodeJS.Timeout | null = null;

export function startBackgroundSync() {
  if (fastSyncTimer) clearInterval(fastSyncTimer);
  if (fullSyncTimer) clearInterval(fullSyncTimer);

  // Fast check every 6 seconds for instantaneous detection of new uploads
  fastSyncTimer = setInterval(() => {
    fastCheckNewDriveUploads().catch(() => {});
  }, 6000);

  // Full comprehensive scan every 30 seconds
  fullSyncTimer = setInterval(() => {
    syncGoogleDriveFolder(DEFAULT_DRIVE_FOLDER_ID)
      .then(() => {
        preloadTopTracksAudio(10).catch(() => {});
      })
      .catch((e) => {
        console.warn("[DriveSync] Background poll error:", e);
      });
  }, 30000);
}

// Start background sync and progressive audio caching on server startup
startBackgroundSync();
setTimeout(() => {
  preloadTopTracksAudio(10)
    .then(() => cacheAllTracksInBackground())
    .catch(() => {});
}, 1500);
