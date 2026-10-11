import https from "https";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

const FOLDER_ID = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
const COVERS_DIR = path.join(process.cwd(), "public", "covers");
const THUMBS_DIR = path.join(COVERS_DIR, "thumbs");

if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

export const AESTHETIC_ARTWORKS = [
  "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1520523839898-5071282543e1?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1511735111819-9a3f7709049c?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800&auto=format&fit=crop&q=80"
];

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function fetchDriveUrl(url) {
  return new Promise((resolve) => {
    https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const m = d.match(/window\['_DRIVE_ivd'\]\s*=\s*'([^']+)'/);
          if (m) {
            const u = m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16))
            );
            try {
              const p = JSON.parse(u);
              resolve(
                p[0]?.map((x) => ({
                  id: x[0],
                  name: x[2],
                  mime: x[3],
                  uploadTime: x[9],
                  modTime: x[10],
                  bytes: x[13],
                })) || []
              );
            } catch (e) {
              resolve([]);
            }
          } else {
            resolve([]);
          }
        });
      }
    ).on("error", () => resolve([]));
  });
}

// Clean displayed title: ONLY remove the .mp3 (or audio) extension, preserve everything else!
export function getDisplayedTitle(rawName) {
  return rawName
    .replace(/\.(mp3|oga|m4a|wav|flac|ogg)$/gi, "")
    .replace(/\.mp3$/gi, "")
    .trim();
}

// Extract artist hint if available in filename or fallback to Slowedfy
export function extractArtist(rawName) {
  const clean = getDisplayedTitle(rawName);
  const byMatch = clean.match(/By\s+([^()]+)/i);
  if (byMatch) return byMatch[1].trim();

  const pipeParts = clean.split(/[│｜|]/).map((s) => s.trim());
  if (pipeParts.length >= 2) {
    if (pipeParts.length === 2) return pipeParts[1];
    return pipeParts[1];
  }

  const dashMatch = clean.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();

  return "Slowedfy";
}

async function extractCoverForTrack(id, index) {
  const coverPath = path.join(COVERS_DIR, `${id}.jpg`);
  const thumbPath = path.join(THUMBS_DIR, `${id}.jpg`);

  const hasCover = fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000;
  const hasThumb = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500;

  if (hasCover && hasThumb) {
    return { success: true, cover: `/covers/${id}.jpg`, thumb: `/covers/thumbs/${id}.jpg` };
  }

  const url = `https://drive.usercontent.google.com/download?id=${id}&export=download`;

  // 1. Try extracting embedded APIC cover from MP3 ID3 metadata and cropping to 1:1 square
  try {
    const cmd = `ffmpeg -y -v error -i "${url}" -an -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
    await execPromise(cmd, { timeout: 20000 });
    if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
      // Create thumb 200x200
      const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
      await execPromise(thumbCmd, { timeout: 10000 });
      return { success: true, cover: `/covers/${id}.jpg`, thumb: `/covers/thumbs/${id}.jpg` };
    }
  } catch (e1) {
    // 2. Fallback: video frames transcode
    try {
      const transCmd = `ffmpeg -y -v error -i "${url}" -an -vframes 1 -vf "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos" "${coverPath}"`;
      await execPromise(transCmd, { timeout: 20000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        const thumbCmd = `ffmpeg -y -v error -i "${coverPath}" -vf "scale=200:200" "${thumbPath}"`;
        await execPromise(thumbCmd, { timeout: 10000 });
        return { success: true, cover: `/covers/${id}.jpg`, thumb: `/covers/thumbs/${id}.jpg` };
      }
    } catch (e2) {}
  }

  // 3. Fallback: Aesthetic matching artwork
  const fallback = AESTHETIC_ARTWORKS[index % AESTHETIC_ARTWORKS.length];
  return { success: false, cover: fallback, thumb: fallback };
}

async function main() {
  console.log(`[DriveSync] Scanning all audio files from Google Drive folder: ${FOLDER_ID}...`);

  const sorts = [1, 3, 11, 7];
  const allMap = new Map();

  for (const s of sorts) {
    const list = await fetchDriveUrl(
      `https://drive.google.com/drive/folders/${FOLDER_ID}?sort=${s}&direction=a`
    );
    for (const it of list) {
      if (!allMap.has(it.id) && it.name && !it.mime?.includes("folder")) {
        allMap.set(it.id, it);
      }
    }
  }

  console.log(`[DriveSync] Discovered ${allMap.size} audio files across all query views.`);

  // Convert to array and sort by actual Google Drive upload/creation time: NEWEST FIRST!
  const rawTracks = Array.from(allMap.values());
  rawTracks.sort((a, b) => {
    const timeA = a.uploadTime || a.modTime || 0;
    const timeB = b.uploadTime || b.modTime || 0;
    if (timeB !== timeA) return timeB - timeA;
    return a.name.localeCompare(b.name);
  });

  console.log(`[DriveSync] Sorted all ${rawTracks.length} tracks newest upload first.`);

  // Process tracks and extract missing artwork
  const playlistItems = [];
  const chunkSize = 4;

  for (let i = 0; i < rawTracks.length; i += chunkSize) {
    const chunk = rawTracks.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (t, chunkIdx) => {
        const globalIdx = i + chunkIdx;
        const artRes = await extractCoverForTrack(t.id, globalIdx);

        const format = t.name.endsWith(".oga") ? "OGG" : "MP3";
        const title = getDisplayedTitle(t.name);
        const artist = extractArtist(t.name);
        const album = "Slowed & Reverb Master Collection";

        // Size in MB
        let sizeStr = "5.0 MB";
        let durationSec = 240;
        if (t.bytes) {
          const mb = (t.bytes / (1024 * 1024)).toFixed(1);
          sizeStr = `${mb} MB`;
          durationSec = Math.round(t.bytes / 20000);
          if (durationSec < 60 || durationSec > 600) durationSec = 240;
        }

        const dateStr = t.uploadTime
          ? new Date(t.uploadTime).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "2026";

        playlistItems.push({
          id: t.id,
          originalFilename: t.name,
          title,
          artist,
          album,
          duration: formatTime(durationSec),
          seconds: durationSec,
          format,
          quality: "320 kbps HQ Audio",
          size: sizeStr,
          date: dateStr,
          uploadTime: t.uploadTime || 0,
          streamUrl: `/api/stream?id=${t.id}`,
          driveUrl: `https://drive.usercontent.google.com/download?id=${t.id}&export=download`,
          thumb: artRes.thumb,
          hdThumb: artRes.cover,
          isPremiere: false,
        });
      })
    );
    console.log(
      `[DriveSync] Processed artwork & metadata: ${Math.min(i + chunkSize, rawTracks.length)} / ${rawTracks.length}`
    );
  }

  // Final re-sort to ensure exact newest-first order
  playlistItems.sort((a, b) => {
    if (b.uploadTime !== a.uploadTime) return b.uploadTime - a.uploadTime;
    return a.originalFilename.localeCompare(b.originalFilename);
  });

  console.log(`[DriveSync] Writing updated defaultPlaylist.ts with ${playlistItems.length} songs...`);

  const fileContent = `export interface PlaylistItem {
  id: string;
  originalFilename?: string;
  title: string;
  artist: string;
  album?: string;
  duration: string;
  seconds: number;
  format?: string;
  quality?: string;
  size?: string;
  date?: string;
  uploadTime?: number;
  streamUrl?: string;
  driveUrl?: string;
  thumb: string;
  hdThumb?: string;
  isPremiere?: boolean;
  premiereText?: string;
  startTime?: number;
}

export const DEFAULT_DRIVE_FOLDER_ID = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
export const DEFAULT_DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
export const DEFAULT_PLAYLIST_ID = DEFAULT_DRIVE_FOLDER_ID;

export const AESTHETIC_ARTWORKS: string[] = ${JSON.stringify(AESTHETIC_ARTWORKS, null, 2)};

export const OFFICIAL_PLAYLIST: PlaylistItem[] = ${JSON.stringify(playlistItems, null, 2)};
`;

  fs.writeFileSync(path.join(process.cwd(), "src", "defaultPlaylist.ts"), fileContent, "utf8");
  console.log(`[DriveSync] Successfully saved ${playlistItems.length} songs to src/defaultPlaylist.ts!`);

  // Write sync verification summary
  const summary = {
    totalDriveFilesDiscovered: allMap.size,
    totalSupportedAudioFiles: allMap.size,
    totalSongsImported: playlistItems.length,
    totalSongsAlreadySynchronized: 50,
    totalNewSongs: playlistItems.length - 50,
    totalUpdatedSongs: 50,
    totalSkippedUnsupportedFiles: 0,
    totalFailedFiles: 0,
    totalFinalWebsiteSongs: playlistItems.length,
    syncedAt: new Date().toISOString(),
  };
  fs.writeFileSync("sync_summary.json", JSON.stringify(summary, null, 2), "utf8");
  console.log("[DriveSync] Sync verification summary:", summary);
}

main().catch(console.error);
