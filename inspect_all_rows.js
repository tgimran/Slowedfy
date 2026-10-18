import fs from "fs";

const html = fs.readFileSync("drive_sample.html", "utf-8");
const ivdMatch = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*['"]([^'"]+)['"]/);
const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
  String.fromCharCode(parseInt(hex, 16))
);
const parsed = JSON.parse(unescaped);

function extractItemsFromAnyArray(arr, results = []) {
  if (!arr || !Array.isArray(arr)) return results;
  // If this arr looks like a row: arr[0] is string ID of length >= 25, arr[2] is filename
  if (arr.length >= 4 && typeof arr[0] === "string" && /^[a-zA-Z0-9_-]{25,}$/.test(arr[0]) && typeof arr[2] === "string") {
    results.push(arr);
    return results;
  }
  for (const item of arr) {
    if (Array.isArray(item)) {
      extractItemsFromAnyArray(item, results);
    }
  }
  return results;
}

const allRows = extractItemsFromAnyArray(parsed);
console.log("Total rows found recursively in entire _DRIVE_ivd:", allRows.length);
const seen = new Set();
const uniqueRows = allRows.filter(r => {
  if (seen.has(r[0])) return false;
  seen.add(r[0]);
  return true;
});
console.log("Unique rows in _DRIVE_ivd:", uniqueRows.length);
console.log("Unique filenames:", uniqueRows.slice(0, 10).map(r => r[2]));
