import https from "https";
import fs from "fs";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
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
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    ).on("error", reject);
  });
}

async function main() {
  const folderId = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
  const html = await fetchHtml(`https://drive.google.com/drive/folders/${folderId}`);
  fs.writeFileSync("folder_raw.html", html);
  console.log("Wrote folder_raw.html, size:", html.length);

  // Look for window['_DRIVE_ivd']
  const ivdMatch = html.match(/window\['_DRIVE_ivd'\]\s*=\s*'([^']+)'/);
  if (ivdMatch) {
    const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    fs.writeFileSync("drive_ivd.json", unescaped);
    const parsed = JSON.parse(unescaped);
    console.log("drive_ivd items:", parsed[0]?.length);
    console.log("drive_ivd page token info:", JSON.stringify(parsed[4])?.substring(0, 150));
  }

  // Look for all callbacks
  const callbacks = html.match(/AF_initDataCallback\(\{[\s\S]*?\}\);/g) || [];
  console.log("AF_initDataCallbacks found:", callbacks.length);
  for (let cb of callbacks) {
    const keyMatch = cb.match(/key:\s*'([^']+)'/);
    const key = keyMatch ? keyMatch[1] : "unknown";
    const dataIdx = cb.indexOf("data:");
    const endIdx = cb.lastIndexOf("});");
    const jsonStr = cb.substring(dataIdx + 5, endIdx).trim();
    try {
      const parsed = eval("(" + jsonStr + ")");
      console.log(`Callback ${key} parsed, top length:`, Array.isArray(parsed) ? parsed.length : typeof parsed);
    } catch (e) {
      console.log(`Callback ${key} parse error:`, e.message);
    }
  }
}

main().catch(console.error);
