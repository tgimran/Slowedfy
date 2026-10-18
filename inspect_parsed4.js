import fs from "fs";

const html = fs.readFileSync("drive_sample.html", "utf-8");
const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
if (ivdMatch) {
  const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const parsed = JSON.parse(unescaped);
  console.log("parsed[0] length:", parsed[0] ? parsed[0].length : 0);
  if (parsed[4] && parsed[4][0]) {
    console.log("parsed[4][0] length:", parsed[4][0].length);
    console.log("parsed[4][0][0] is array?", Array.isArray(parsed[4][0][0]), "length:", parsed[4][0][0].length);
    console.log("parsed[4][0][1]:", parsed[4][0][1]);
    console.log("parsed[4][0][2] is item?", Array.isArray(parsed[4][0][2]), parsed[4][0][2] ? parsed[4][0][2][2] : null);
    console.log("parsed[4][0][3] token:", typeof parsed[4][0][3], parsed[4][0][3].slice(0, 30));
  }
}
