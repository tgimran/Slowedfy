import { getCachedDrivePlaylist, syncGoogleDriveFolder } from "./src/driveSync.ts";

async function test() {
  console.log("Cached playlist length before sync:", getCachedDrivePlaylist().length);
  console.log("Top track before sync:", getCachedDrivePlaylist()[0].title, getCachedDrivePlaylist()[0].id);
  
  console.log("Starting syncGoogleDriveFolder...");
  const t0 = Date.now();
  const res = await syncGoogleDriveFolder();
  console.log("Sync finished in", Date.now() - t0, "ms");
  console.log("Result length:", res.length);
  console.log("Top track after sync:", res[0].title, res[0].id, "uploadTime:", res[0].uploadTime);
}

test().catch(console.error);
