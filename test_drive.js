import https from "https";
import fs from "fs";

function testDrive() {
  const url = "https://drive.google.com/drive/folders/194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
  https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } }, res => {
    console.log("Status:", res.statusCode, "Location:", res.headers.location);
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log("Redirecting to:", res.headers.location);
    }
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => {
      console.log("Length:", data.length);
      console.log("Has _DRIVE_ivd:", data.includes("_DRIVE_ivd"));
      console.log("Has AF_initDataCallback:", data.includes("AF_initDataCallback"));
      const matches = data.match(/AF_initDataCallback/g);
      console.log("AF_initDataCallback count:", matches ? matches.length : 0);
      const afChunks = data.match(/AF_initDataCallback\(\{key:\s*'ds:\d+'[^}]+data:function\(\)\{return\s+(\[[\s\S]*?\])\s*\}\}\);/g);
      console.log("afChunks matched:", afChunks ? afChunks.length : 0);
      fs.writeFileSync("drive_sample.html", data);
      console.log("Saved drive_sample.html");
    });
  });
}
testDrive();
