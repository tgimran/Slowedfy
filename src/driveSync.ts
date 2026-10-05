import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";
import {
  PlaylistItem,
  OFFICIAL_PLAYLIST,
  DEFAULT_DRIVE_FOLDER_ID,
  AESTHETIC_ARTWORKS,
} from "./defaultPlaylist";

const execPromise = util.promisify(exec);
const COVERS_DIR = path.join(process.cwd(), "public", "covers");
const THUMBS_DIR = path.join(COVERS_DIR, "thumbs");
const AUDIO_CACHE_DIR = path.join(process.cwd(), "public", "audio_cache");

if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

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
let lastSyncTimestamp = Date.now();
let lastSyncSummary: SyncSummary = {
  totalDriveFilesDiscovered: OFFICIAL_PLAYLIST.length,
  totalValidAudioFiles: OFFICIAL_PLAYLIST.length,
  totalFilesInSubfolders: 0,
  totalAlreadyImported: OFFICIAL_PLAYLIST.length,
  totalNewlyImported: 0,
  totalUpdated: 0,
  totalDuplicates: 0,
  totalSkipped: 0,
  skippedFilesDetails: [],
  finalWebsiteSongs: OFFICIAL_PLAYLIST.length,
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

export function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
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
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Drive request timeout"));
    });
  });
}

/**
 * Extract embedded APIC / Attached Picture from MP3 file and crop to 1:1 square.
 * Runs in background asynchronously so playback is NEVER blocked.
 */
export async function extractEmbeddedCoverForTrack(
  trackId: string,
  index = 0
): Promise<{ success: boolean; cover: string; thumb: string }> {
  const coverPath = path.join(COVERS_DIR, `${trackId}.jpg`);
  const thumbPath = path.join(THUMBS_DIR, `${trackId}.jpg`);

  const hasCover = fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000;
  const hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500;

  if (hasCover && hasThumb) {
    return {
      success: true,
      cover: `/covers/${trackId}.jpg`,
      thumb: `/covers/thumbs/${trackId}.jpg`,
    };
  }

  const localAudioPath = path.join(AUDIO_CACHE_DIR, `${trackId}.mp3`);
  const inputSource =
    fs.existsSync(localAudioPath) && fs.statSync(localAudioPath).size > 50000
      ? localAudioPath
      : `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;

  try {
    const cmd = `ffmpeg -y -v error -i "${inputSource}" -an -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
    await execPromise(cmd, { timeout: 15000 });
    if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
      const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
      await execPromise(thumbCmd, { timeout: 10000 });
      return {
        success: true,
        cover: `/covers/${trackId}.jpg`,
        thumb: `/covers/thumbs/${trackId}.jpg`,
      };
    }
  } catch (e1) {
    try {
      const transCmd = `ffmpeg -y -v error -i "${inputSource}" -an -vframes 1 -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
      await execPromise(transCmd, { timeout: 15000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 10000 });
        return {
          success: true,
          cover: `/covers/${trackId}.jpg`,
          thumb: `/covers/thumbs/${trackId}.jpg`,
        };
      }
    } catch (e2) {}
  }

  const fallback = AESTHETIC_ARTWORKS[index % AESTHETIC_ARTWORKS.length];
  return { success: false, cover: fallback, thumb: fallback };
}

interface RawDriveFile {
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
          const bytes = row[13] || 0;
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
 * Scans a folder recursively across multiple sort and direction views.
 */
async function scanFolderFiles(folderId: string): Promise<{ audioFiles: RawDriveFile[]; subfolderCount: number }> {
  const queryUrls = [
    `https://drive.google.com/drive/folders/${folderId}?sort=1`,
    `https://drive.google.com/drive/folders/${folderId}?sort=1&dir=d`,
    `https://drive.google.com/drive/folders/${folderId}?sort=3`,
    `https://drive.google.com/drive/folders/${folderId}?sort=3&dir=a`,
    `https://drive.google.com/drive/folders/${folderId}?sort=11`,
    `https://drive.google.com/drive/folders/${folderId}?sort=11&dir=a`,
    `https://drive.google.com/drive/folders/${folderId}?sort=7`,
    `https://drive.google.com/drive/folders/${folderId}?sort=7&dir=a`,
  ];

  const allDiscovered = new Map<string, RawDriveFile>();
  const subfolders: string[] = [];

  for (const u of queryUrls) {
    try {
      const html = await fetchHtml(u);
      const items = parseDriveItemsFromHtml(html);
      for (const it of items) {
        if (!allDiscovered.has(it.id)) {
          allDiscovered.set(it.id, it);
          if (it.isFolder) {
            subfolders.push(it.id);
          }
        }
      }
    } catch (err) {
      console.warn(`[DriveSync] Error querying view ${u}:`, err);
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
    } catch (err) {
      console.warn(`[DriveSync] Error recursively scanning subfolder ${subId}:`, err);
    }
  }

  const audioFiles = Array.from(allDiscovered.values()).filter((f) => !f.isFolder);
  return { audioFiles, subfolderCount };
}

/**
 * Synchronize Google Drive folder completely:
 * - Detects all songs without any 50/91 limit
 * - Preserves original Drive filename (removes only audio extension)
 * - Sorts newest uploaded song first
 * - Incremental sync (maintains Drive file ID)
 * - Background artwork extraction
 * - Computes sync verification summary
 */
export async function syncGoogleDriveFolder(
  folderId: string = DEFAULT_DRIVE_FOLDER_ID
): Promise<PlaylistItem[]> {
  try {
    const { audioFiles, subfolderCount } = await scanFolderFiles(folderId);

    const validAudios: RawDriveFile[] = [];
    const skippedFiles: SkippedFileDetail[] = [];

    for (const f of audioFiles) {
      const isAudioExt = /\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/i.test(f.name);
      const isAudioMime = f.mime?.startsWith("audio/") || f.mime === "application/octet-stream";

      if (isAudioExt || isAudioMime) {
        validAudios.push(f);
      } else {
        skippedFiles.push({
          id: f.id,
          name: f.name,
          reason: `Unsupported MIME type (${f.mime}) and non-audio extension.`,
        });
      }
    }

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
      let durationSec = existing?.seconds || 240;
      if (f.bytes > 0) {
        const mb = (f.bytes / (1024 * 1024)).toFixed(1);
        sizeStr = `${mb} MB`;
        durationSec = Math.round(f.bytes / 20000);
        if (durationSec < 60 || durationSec > 600) durationSec = 240;
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
        : existing?.thumb || AESTHETIC_ARTWORKS[idx % AESTHETIC_ARTWORKS.length];

      const hdThumb = localCoverExists
        ? `/covers/${f.id}.jpg`
        : existing?.hdThumb || thumb;

      const trackItem: PlaylistItem = {
        id: f.id,
        originalFilename: f.name,
        title,
        artist,
        album: "Slowed & Reverb Master Collection",
        duration: formatTime(durationSec),
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
        // Trigger background embedded artwork extraction for new songs (non-blocking)
        extractEmbeddedCoverForTrack(f.id, idx).catch(() => {});
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
  return new Promise((resolve) => {
    const file = fs.createWriteStream(tmpPath);
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
          // Follow redirect
          const redFile = fs.createWriteStream(tmpPath);
          https.get(res.headers.location, (redRes) => {
            redRes.pipe(redFile);
            redFile.on("finish", () => {
              redFile.close(() => {
                try {
                  if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 50000) {
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
          }).on("error", () => {
            redFile.close();
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
            resolve(false);
          });
          return;
        }

        if (res.statusCode !== 200) {
          file.close();
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
          return resolve(false);
        }

        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            try {
              if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 50000) {
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
      file.close();
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
      resolve(false);
    });
  });
}

let isPreloadingAudio = false;
export async function preloadTopTracksAudio(count = 110) {
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

// Background auto-polling timer: checks for new songs every 20 seconds
let syncIntervalTimer: NodeJS.Timeout | null = null;

export function startBackgroundSync(intervalMs = 20000) {
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);
  syncIntervalTimer = setInterval(() => {
    syncGoogleDriveFolder(DEFAULT_DRIVE_FOLDER_ID)
      .then(() => {
        preloadTopTracksAudio(15).catch(() => {});
      })
      .catch((e) => {
        console.warn("[DriveSync] Background poll error:", e);
      });
  }, intervalMs);
}

// Start background sync on server startup
startBackgroundSync(20000);
setTimeout(() => preloadTopTracksAudio(20).catch(() => {}), 1000);

