import fs from "fs";

const html = fs.readFileSync("drive_sample.html", "utf-8");

// Search for token or page or continuation
const afMatches = html.matchAll(/AF_initDataCallback\s*\(\s*(\{.*?key\s*:\s*['"](ds:\d+)['"].*?\})\s*\)\s*;/gs);
for (const m of afMatches) {
  const key = m[2];
  try {
    const fn = new Function("return " + m[1]);
    const obj = fn();
    console.log("AF Key:", key, "has data:", !!obj.data);
    if (obj.data) {
      const s = JSON.stringify(obj.data);
      console.log("Key", key, "data length:", s.length);
      // look for continuation token or page token
      // in drive ivd, continuation token is usually at parsed[1] or row[x]
    }
  } catch(e) {}
}

const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
if (ivdMatch) {
  const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const parsed = JSON.parse(unescaped);
  console.log("parsed keys in _DRIVE_ivd:", Object.keys(parsed));
  console.log("parsed[1]:", parsed[1]);
  console.log("parsed[2]:", parsed[2]);
  console.log("parsed[3]:", parsed[3]);
  console.log("parsed[4]:", parsed[4]);
}
