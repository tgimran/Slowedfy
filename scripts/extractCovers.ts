import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { OFFICIAL_PLAYLIST } from "../src/defaultPlaylist.ts";

const execPromise = util.promisify(exec);

const COVERS_DIR = path.join(process.cwd(), "public", "covers");
if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

export async function extractEmbeddedCoverForTrack(trackId: string, trackUrl?: string): Promise<{ success: boolean; path?: string; width?: number; height?: number }> {
  const coverPath = path.join(COVERS_DIR, `${trackId}.jpg`);

  if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
    return { success: true, path: `/covers/${trackId}.jpg` };
  }

  const url = trackUrl || `https://drive.usercontent.google.com/download?id=${trackId}&export=download`;

  // 1. Try extracting attached picture (front cover) via ffmpeg copy
  try {
    const copyCmd = `ffmpeg -y -v error -i "${url}" -an -vcodec copy "${coverPath}"`;
    await execPromise(copyCmd, { timeout: 12000 });
    if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
      return { success: true, path: `/covers/${trackId}.jpg` };
    }
  } catch (e1) {
    // 2. If copy failed (e.g. png or non-mjpeg stream), transcode 1st video frame to clean JPEG
    try {
      const transCmd = `ffmpeg -y -v error -i "${url}" -an -vframes 1 -q:v 2 "${coverPath}"`;
      await execPromise(transCmd, { timeout: 12000 });
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 1000) {
        return { success: true, path: `/covers/${trackId}.jpg` };
      }
    } catch (e2) {}
  }

  return { success: false };
}

async function run() {
  console.log(`[CoverExtractor] Scanning and extracting embedded MP3 ID3 album art for ${OFFICIAL_PLAYLIST.length} tracks...`);
  const chunkSize = 5;
  const results: { id: string; success: boolean; size?: number }[] = [];

  for (let i = 0; i < OFFICIAL_PLAYLIST.length; i += chunkSize) {
    const slice = OFFICIAL_PLAYLIST.slice(i, i + chunkSize);
    const chunkRes = await Promise.all(
      slice.map(async (t) => {
        const res = await extractEmbeddedCoverForTrack(t.id);
        const coverPath = path.join(COVERS_DIR, `${t.id}.jpg`);
        const size = fs.existsSync(coverPath) ? fs.statSync(coverPath).size : 0;
        return { id: t.id, success: res.success, size };
      })
    );
    results.push(...chunkRes);
    console.log(`[CoverExtractor] Processed ${Math.min(i + chunkSize, OFFICIAL_PLAYLIST.length)} of ${OFFICIAL_PLAYLIST.length}`);
  }

  const extracted = results.filter((r) => r.success);
  console.log(`[CoverExtractor] Completed! Successfully extracted ${extracted.length} embedded album arts out of ${OFFICIAL_PLAYLIST.length} tracks.`);
  fs.writeFileSync(path.join(process.cwd(), "cover_extraction_summary.json"), JSON.stringify(results, null, 2));
}

if (process.argv[1]?.endsWith("extractCovers.ts")) {
  run();
}
