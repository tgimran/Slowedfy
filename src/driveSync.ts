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

export function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    parsed.searchParams.set("_t", Date.now().toString());
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
          res.headers.location
        ) {
          return fetchHtml(res.headers.location).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => {
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
    if (fs.existsSync(distDir)) {
      const dest = path.join(distDir, filename);
      fs.copyFileSync(srcFile, dest);
    }
  } catch (e) {}
}

/**
 * Extract embedded APIC / Attached Picture from audio, companion Drive image, or iTunes API.
 * Guarantees that every track gets high-resolution square artwork and thumbnail.
 */
export async function extractEmbeddedCoverForTrack(
  trackId: string,
  trackTitle = "",
  trackArtist = "",
  companionImageId?: string
): Promise<{ success: boolean; cover: string; thumb: string }> {
  const coverPath = path.join(COVERS_DIR, `${trackId}.jpg`);
  const thumbPath = path.join(THUMBS_DIR, `${trackId}.jpg`);

  const hasCover = fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000;
  const hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500;

  if (hasCover && hasThumb) {
    syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
    syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
    return {
      success: true,
      cover: `/covers/${trackId}.jpg`,
      thumb: `/covers/thumbs/${trackId}.jpg`,
    };
  }

  // 1. If companion image uploaded in Google Drive folder, download directly
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

  // 2. Try extracting attached picture (ID3 APIC) from local cached audio
  const localAudioPath = path.join(AUDIO_CACHE_DIR, `${trackId}.mp3`);
  if (fs.existsSync(localAudioPath) && fs.statSync(localAudioPath).size > 50000) {
    try {
      const cmd = `ffmpeg -y -v error -i "${localAudioPath}" -an -vcodec copy "${coverPath}"`;
      await execPromise(cmd, { timeout: 10000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 10000 });
        syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
        syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
        return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
      }
    } catch (e) {
      try {
        const cmd = `ffmpeg -y -v error -i "${localAudioPath}" -an -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
        await execPromise(cmd, { timeout: 10000 });
        if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
          const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
          await execPromise(thumbCmd, { timeout: 10000 });
          syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
          syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
          return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
        }
      } catch (e2) {}
    }
  }

  // 3. Direct extraction from Google Drive stream (copies embedded 1080x1080 front cover)
  const driveAudioUrl = `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;
  try {
    const copyCmd = `ffmpeg -y -v error -i "${driveAudioUrl}" -an -vcodec copy "${coverPath}"`;
    await execPromise(copyCmd, { timeout: 14000 });
    if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
      const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
      await execPromise(thumbCmd, { timeout: 8000 });
      syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
      syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
      return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
    }
  } catch (eCopy) {
    try {
      const transCmd = `ffmpeg -y -v error -i "${driveAudioUrl}" -an -vframes 1 -q:v 2 "${coverPath}"`;
      await execPromise(transCmd, { timeout: 14000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 8000 });
        syncFileToDist(coverPath, DIST_COVERS_DIR, `${trackId}.jpg`);
        syncFileToDist(thumbPath, DIST_THUMBS_DIR, `${trackId}.jpg`);
        return { success: true, cover: `/covers/${trackId}.jpg`, thumb: `/covers/thumbs/${trackId}.jpg` };
      }
    } catch (eTrans) {}
  }

  // 4. Download first 2.5MB of audio file from Drive and extract embedded cover
  const tempAudioPath = path.join(AUDIO_CACHE_DIR, `part_${trackId}.mp3`);
  const gotPartial = await downloadFileStream(driveAudioUrl, tempAudioPath, 2500000);

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

  // 5. High-quality curated aesthetic cover fallback
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
 */
function parseDriveItemsFromHtml(html: string): RawDriveFile[] {
  const items: RawDriveFile[] = [];
  const seenIds = new Set<string>();

  const ivdMatch = html.match(/window\['_DRIVE_ivd'\]\s*=\s*'([^']+)'/);
  if (ivdMatch) {
    try {
      const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
      const parsed = JSON.parse(unescaped);
      if (Array.isArray(parsed[0])) {
        for (const row of parsed[0]) {
          const id = row[0];
          const name = row[2];
          const mime = row[3] || "audio/mpeg";
          const uploadTime = row[9] || 0;
          const modTime = row[10] || 0;
          const bytes = row[13] || row[27] || 0;
          const isFolder = mime === "application/vnd.google-apps.folder" || mime.includes("folder");

          if (id && name && !seenIds.has(id)) {
            seenIds.add(id);
            items.push({ id, name, mime, uploadTime, modTime, bytes, isFolder });
          }
        }
      }
    } catch (e) {}
  }

  return items;
}

/**
 * Scans a folder recursively across multiple sort and direction views in parallel.
 * Captures both audio files and companion image files!
 */
export async function scanFolderFiles(folderId: string): Promise<{
  audioFiles: RawDriveFile[];
  imageFiles: RawDriveFile[];
  subfolderCount: number;
}> {
  const queryUrls = [
    `https://drive.google.com/drive/folders/${folderId}?sort=13&dir=d`,
    `https://drive.google.com/drive/folders/${folderId}?sort=1&dir=d`,
    `https://drive.google.com/drive/folders/${folderId}?sort=11&dir=d`,
    `https://drive.google.com/drive/folders/${folderId}?sort=1`,
    `https://drive.google.com/drive/folders/${folderId}?sort=3`,
    `https://drive.google.com/drive/folders/${folderId}?sort=7`,
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
 * - Incremental sync with instant real-time live notification
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

    validAudios.forEach((f, idx) => {
      const existing = existingMap.get(f.id);
      const title = getDisplayedTitle(f.name);
      const artist = extractArtist(f.name);
      const format = f.name.endsWith(".oga") ? "OGG" : "MP3";

      let sizeStr = existing?.size || "5.0 MB";
      let durationSec = 240;
      let durationFormatted = "04:00";

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
        : existing?.date || "2026";

      const localCoverExists = fs.existsSync(path.join(COVERS_DIR, `${f.id}.jpg`));
      const localThumbExists = fs.existsSync(path.join(THUMBS_DIR, `${f.id}.jpg`));

      const thumb = localThumbExists
        ? `/covers/thumbs/${f.id}.jpg`
        : localCoverExists
        ? `/covers/${f.id}.jpg`
        : existing?.thumb || `/covers/thumbs/${f.id}.jpg`;

      const hdThumb = localCoverExists
        ? `/covers/${f.id}.jpg`
        : existing?.hdThumb || thumb;

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
        uploadTime: f.uploadTime || existing?.uploadTime || 0,
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

    // Process cover art & probe duration for newly detected tracks before finalizing
    if (newlyDetectedTracks.length > 0) {
      console.log(`[DriveSync] Processing album art and durations for ${newlyDetectedTracks.length} newly discovered tracks...`);
      await Promise.allSettled(
        newlyDetectedTracks.map(async (t) => {
          const companion = imageFiles.find((img) => isCompanionImage(img.name, t.originalFilename || t.title));
          const artRes = await extractEmbeddedCoverForTrack(t.id, t.title, t.artist, companion?.id);
          if (artRes.success) {
            t.thumb = artRes.thumb;
            t.hdThumb = artRes.cover;
          }
          await probeAndSyncTrackDuration(t);
        })
      );
    }

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

    // Always persist updated playlist and notify listeners if changes detected
    if (totalNew > 0 || totalUpdated > 0) {
      try {
        const cachePath = path.join(process.cwd(), "public", "drive_playlist_cache.json");
        fs.writeFileSync(cachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
        const distCachePath = path.join(process.cwd(), "dist", "drive_playlist_cache.json");
        if (fs.existsSync(path.join(process.cwd(), "dist"))) {
          fs.writeFileSync(distCachePath, JSON.stringify(cachedDrivePlaylist, null, 2));
        }
      } catch (e) {}

      notifySyncListeners(cachedDrivePlaylist, totalNew, totalUpdated);
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
  if (fs.existsSync(destPath)) {
    try {
      if (fs.statSync(destPath).size > 50000) return true;
    } catch (e) {}
  }
  const tmpPath = destPath + ".tmp";
  const url = `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;
  return downloadFileStream(url, destPath);
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
 * Ultra-fast poll check (every 6 seconds):
 * Fetches the newest modified files view (sort=13&dir=d) from Google Drive.
 * If any file in this view is not in our cached playlist, immediately triggers full sync!
 */
let isFastChecking = false;
export async function fastCheckNewDriveUploads(): Promise<boolean> {
  if (isFastChecking || activeSyncPromise) return false;
  isFastChecking = true;
  try {
    const url = `https://drive.google.com/drive/folders/${DEFAULT_DRIVE_FOLDER_ID}?sort=13&dir=d`;
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

// Start background sync on server startup
startBackgroundSync();
setTimeout(() => preloadTopTracksAudio(10).catch(() => {}), 2000);
