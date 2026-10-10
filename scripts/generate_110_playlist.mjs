import fs from "fs";
import path from "path";
import https from "https";

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseIvd(html) {
  const m = html.match(/window\['_DRIVE_ivd'\]\s*=\s*'([^']+)'/);
  if (!m) return [];
  try {
    const unescaped = m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const parsed = JSON.parse(unescaped);
    return parsed[0] || [];
  } catch (e) {
    return [];
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function getDisplayedTitle(rawName) {
  if (!rawName) return "Unknown Song";
  return rawName
    .replace(/\.(mp3|oga|m4a|wav|flac|ogg)$/gi, "")
    .replace(/\.mp3$/gi, "")
    .trim();
}

export function extractArtist(rawName) {
  const clean = getDisplayedTitle(rawName);
  const byMatch = clean.match(/By\s+([^()]+)/i);
  if (byMatch) return byMatch[1].trim();

  const pipeParts = clean.split(/[│｜|]/).map(s => s.trim());
  if (pipeParts.length >= 2) return pipeParts[1];

  const dashMatch = clean.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();

  return "Slowedfy";
}

async function generate() {
  const folderId = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
  const urls = [
    "https://drive.google.com/drive/folders/" + folderId + "?sort=1",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=1&dir=d",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=3",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=3&dir=a",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=11",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=11&dir=a",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=7",
    "https://drive.google.com/drive/folders/" + folderId + "?sort=7&dir=a"
  ];

  const allTracks = new Map();
  for (const u of urls) {
    const html = await fetch(u);
    for (const it of parseIvd(html)) {
      if (!allTracks.has(it[0])) {
        allTracks.set(it[0], {
          id: it[0],
          name: it[2],
          mime: it[3],
          bytes: it[13],
          uploadTime: it[9] || 0,
          modTime: it[10] || 0
        });
      }
    }
  }

  console.log(`Discovered ${allTracks.size} tracks across all queries.`);

  const list = Array.from(allTracks.values());
  // Sort newest uploaded song first
  list.sort((a, b) => {
    const timeA = a.uploadTime || a.modTime || 0;
    const timeB = b.uploadTime || b.modTime || 0;
    if (timeB !== timeA) return timeB - timeA;
    return a.name.localeCompare(b.name);
  });

  const coversDir = path.join(process.cwd(), "public", "covers");
  const thumbsDir = path.join(coversDir, "thumbs");

  const playlistItems = list.map((t, idx) => {
    const title = getDisplayedTitle(t.name);
    const artist = extractArtist(t.name);
    const format = t.name.endsWith(".oga") ? "OGG" : "MP3";

    let durationSec = 240;
    let sizeStr = "5.0 MB";
    if (t.bytes > 0) {
      sizeStr = `${(t.bytes / (1024 * 1024)).toFixed(1)} MB`;
      durationSec = Math.round(t.bytes / 20000);
      if (durationSec < 60 || durationSec > 600) durationSec = 240;
    }

    const dateStr = t.uploadTime
      ? new Date(t.uploadTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : "2026";

    const hasLocalCover = fs.existsSync(path.join(coversDir, `${t.id}.jpg`));
    const hasLocalThumb = fs.existsSync(path.join(thumbsDir, `${t.id}.jpg`));

    const thumb = hasLocalThumb ? `/covers/thumbs/${t.id}.jpg` : hasLocalCover ? `/covers/${t.id}.jpg` : "/covers/thumbs/1YGDaQpEHdUaGVfpKnFtqehId3uer0a4H.jpg";
    const hdThumb = hasLocalCover ? `/covers/${t.id}.jpg` : thumb;

    return {
      id: t.id,
      originalFilename: t.name,
      title,
      artist,
      album: "Slowed & Reverb Master Collection",
      duration: formatTime(durationSec),
      seconds: durationSec,
      format,
      quality: "320 kbps HQ Audio",
      size: sizeStr,
      date: dateStr,
      uploadTime: t.uploadTime,
      streamUrl: `/api/stream?id=${t.id}`,
      driveUrl: `https://drive.usercontent.google.com/download?id=${t.id}&export=download`,
      thumb,
      hdThumb,
      isPremiere: false
    };
  });

  const content = `// Auto-generated Slowedfy Master Library from Google Drive Folder: ${folderId}
// Total Tracks: ${playlistItems.length} (Newest Uploads First)
// Generated at: ${new Date().toISOString()}

export interface PlaylistItem {
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
}

export const DEFAULT_DRIVE_FOLDER_ID = "${folderId}";
export const DEFAULT_DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/${folderId}";
export const DEFAULT_PLAYLIST_ID = DEFAULT_DRIVE_FOLDER_ID;

export const AESTHETIC_ARTWORKS: string[] = [
  "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&auto=format&fit=crop&q=80"
];

export const OFFICIAL_PLAYLIST: PlaylistItem[] = ${JSON.stringify(playlistItems, null, 2)};
`;

  fs.writeFileSync("src/defaultPlaylist.ts", content, "utf8");
  console.log(`Successfully wrote ${playlistItems.length} tracks to src/defaultPlaylist.ts!`);
}

generate().catch(console.error);
