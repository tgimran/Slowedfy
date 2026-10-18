import https from "https";

async function testUrl(url) {
  const start = Date.now();
  return new Promise((resolve) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } }, res => {
      let len = 0;
      res.on("data", c => len += c.length);
      res.on("end", () => {
        resolve({ url, status: res.statusCode, len, time: Date.now() - start });
      });
    }).on("error", err => {
      resolve({ url, error: err.message, time: Date.now() - start });
    });
  });
}

async function main() {
  const folderId = "194R85uwyR_UyKRn6RC9xGsmN87kNC4bF";
  const r1 = await testUrl(`https://drive.google.com/drive/folders/${folderId}`);
  console.log("Base:", r1);
  const r2 = await testUrl(`https://drive.google.com/drive/folders/${folderId}?sort=14&dir=d`);
  console.log("Sort 14 desc:", r2);
}

main();
