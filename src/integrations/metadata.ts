import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
/** Only existing content-addressed uploads can be handed to Solard; never fetch arbitrary URLs. */
export async function uploadedImagePath(image:string):Promise<string> {
 const pathname=image.startsWith("/")?image:new URL(image).pathname;
 const match=/^\/api\/media\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/.exec(pathname);
 if(!match)throw new Error("Upload the token image through the launch form");
 const path=resolve(process.env.LAUNCHSEEDS_ASSETS_PATH||"./data/assets",`${match[1]}.${match[2]}`);
 const bytes=await readFile(path);
 if(createHash("sha256").update(bytes).digest("hex")!==match[1])throw new Error("Uploaded image integrity check failed");
 return path;
}
