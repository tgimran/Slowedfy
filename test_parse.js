import fs from "fs";
import { scanFolderFiles, syncGoogleDriveFolder, getCachedDrivePlaylist } from "./src/driveSync.ts";

async function run() {
  const html = fs.readFileSync("drive_sample.html", "utf-8");
  console.log("HTML length:", html.length);

  // Test scanFolderFiles
  const res = await scanFolderFiles("194R85uwyR_UyKRn6RC9xGsmN87kNC4bF");
  console.log("Discovered audioFiles count:", res.audioFiles.length);
  console.log("Discovered imageFiles count:", res.imageFiles.length);
  console.log("Sample audioFiles (top 5):", res.audioFiles.slice(0, 5).map(f => ({ id: f.id, name: f.name, uploadTime: f.uploadTime, modTime: f.modTime, bytes: f.bytes })));
  console.log("Sample imageFiles (top 5):", res.imageFiles.slice(0, 5).map(f => ({ id: f.id, name: f.name })));
}

run().catch(console.error);
