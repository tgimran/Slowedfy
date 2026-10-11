import https from "https";
import fs from "fs";
import path from "path";

function fetchRange(url, range) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "Range": range, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: { "Range": range, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (redRes) => {
          const chunks = [];
          redRes.on("data", c => chunks.push(c));
          redRes.on("end", () => resolve(Buffer.concat(chunks)));
        }).on("error", reject);
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseMp3Buffer(audioBuf) {
  const xingIdx = audioBuf.indexOf("Xing");
  const infoIdx = audioBuf.indexOf("Info");
  const tagIdx = xingIdx !== -1 ? xingIdx : infoIdx;
  if (tagIdx !== -1) {
    const flags = audioBuf.readUInt32BE(tagIdx + 4);
    if (flags & 1) {
      const frames = audioBuf.readUInt32BE(tagIdx + 8);
      for (let i = tagIdx - 36; i <= tagIdx - 4; i++) {
        if (i >= 0 && audioBuf[i] === 0xFF && (audioBuf[i + 1] & 0xE0) === 0xE0) {
          const mpegVer = (audioBuf[i + 1] >> 3) & 3;
          const srIdx = (audioBuf[i + 2] >> 2) & 3;
          const sr = [44100, 48000, 32000][srIdx];
          const samplesPerFrame = mpegVer === 3 ? 1152 : 576;
          const dur = (frames * samplesPerFrame) / sr;
          const m = Math.floor(dur / 60);
          const s = Math.round(dur % 60);
          return {
            seconds: Math.round(dur),
            duration: (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s
          };
        }
      }
    }
  }
  return null;
}

async function getDurationForTrack(id) {
  // Check local cache first
  const localPath = path.join(process.cwd(), "public", "audio_cache", `${id}.mp3`);
  if (fs.existsSync(localPath)) {
    try {
      const buf = fs.readFileSync(localPath);
      let offset = 0;
      if (buf.toString("utf8", 0, 3) === "ID3") {
        const id3Size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
        offset = 10 + id3Size;
      }
      const parsed = parseMp3Buffer(buf.slice(offset, offset + 4000));
      if (parsed) return parsed;
    } catch (e) {}
  }

  // Fetch range from Google Drive
  const url = `https://drive.usercontent.google.com/download?id=${id}&export=download`;
  try {
    const headBuf = await fetchRange(url, "bytes=0-9");
    let audioStart = 0;
    if (headBuf.toString("utf8", 0, 3) === "ID3") {
      const id3Size = (headBuf[6] << 21) | (headBuf[7] << 14) | (headBuf[8] << 7) | headBuf[9];
      audioStart = 10 + id3Size;
    }
    const audioBuf = await fetchRange(url, `bytes=${audioStart}-${audioStart + 3500}`);
    const parsed = parseMp3Buffer(audioBuf);
    if (parsed) return parsed;
  } catch (e) {
    console.warn(`Failed fetching exact duration for ${id}:`, e.message);
  }
  return null;
}

async function run() {
  const content = fs.readFileSync("index.html", "utf8");
  const match = content.match(/const OFFICIAL_PLAYLIST = (\[[\s\S]*?\]);/);
  const list = JSON.parse(match[1]);
  console.log(`Processing ${list.length} tracks...`);

  const results = {};
  const concurrency = 8;
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    await Promise.all(batch.map(async (t) => {
      const res = await getDurationForTrack(t.id);
      if (res) {
        results[t.id] = res;
      } else {
        results[t.id] = { seconds: t.seconds, duration: t.duration };
      }
      console.log(`[${Object.keys(results).length}/${list.length}] ${t.title.substring(0, 30)} -> ${results[t.id].duration} (${results[t.id].seconds}s)`);
    }));
  }

  fs.writeFileSync("exact_durations.json", JSON.stringify(results, null, 2));
  console.log("Saved all exact durations to exact_durations.json");
}

run();
