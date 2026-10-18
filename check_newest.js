import https from "https";

function parseDriveItemsFromHtml(html) {
  const items = [];
  const seenIds = new Set();
  const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
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
    } catch (e) {}
  }
  return items;
}

function fetch(url) {
  return new Promise(resolve => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
  });
}

async function check() {
  const folderId = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
  const html = await fetch(`https://drive.google.com/drive/folders/${folderId}?sort=14&dir=d`);
  const items = parseDriveItemsFromHtml(html);
  console.log("Sort 14 desc items count:", items.length);
  console.log("Top 5 newest items (by Sort 14 desc):");
  items.slice(0, 5).forEach((item, i) => {
    console.log(`${i+1}. ${item.name} (${new Date(item.uploadTime).toISOString()}) id: ${item.id}`);
  });
}

check();
