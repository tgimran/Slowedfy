import fs from "fs";

function parseDriveItemsFromHtml(html) {
  const items = [];
  const seenIds = new Set();

  // 1. window['_DRIVE_ivd']
  const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
  console.log("ivdMatch found?", !!ivdMatch);
  if (ivdMatch) {
    try {
      const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
      const parsed = JSON.parse(unescaped);
      console.log("ivd rows count:", parsed[0] ? parsed[0].length : 0);
      if (Array.isArray(parsed[0])) {
        for (const row of parsed[0]) {
          const id = row[0];
          const name = row[2];
          const mime = row[3] || "audio/mpeg";
          const uploadTime = Number(row[9]) || 0;
          const modTime = Number(row[10]) || 0;
          const bytes = Number(row[13]) || Number(row[27]) || 0;
          const isFolder = mime === "application/vnd.google-apps.folder" || mime.includes("folder");

          if (id && name && typeof id === "string" && typeof name === "string" && !seenIds.has(id)) {
            seenIds.add(id);
            items.push({ id, name, mime, uploadTime, modTime, bytes, isFolder });
          }
        }
      }
    } catch (e) {
      console.error("ivd parse error:", e);
    }
  }

  // 2. Parse all AF_initDataCallback blocks
  try {
    const afMatches = html.matchAll(/AF_initDataCallback\s*\(\s*(\{.*?key\s*:\s*['"]ds:\d+['"].*?\})\s*\)\s*;/gs);
    let afCount = 0;
    for (const m of afMatches) {
      afCount++;
      try {
        const fn = new Function("return " + m[1]);
        const obj = fn();
        if (obj && obj.data) {
          const walkData = (node) => {
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
    console.log("AF callbacks processed:", afCount);
  } catch (e) {}

  return items;
}

const html = fs.readFileSync("drive_sample.html", "utf-8");
const items = parseDriveItemsFromHtml(html);
console.log("Total items parsed:", items.length);
const audios = items.filter(f => /\.(mp3|oga|m4a|wav|flac|ogg|aac|opus|wma)$/i.test(f.name));
console.log("Audio files found:", audios.length);
console.log("Top 5 audios:", audios.slice(0, 5));
