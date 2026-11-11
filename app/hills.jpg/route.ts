import { join } from "node:path";

/** The LaunchSeeds hills image, served from assets/. */
export function GET() {
  return new Response(Bun.file(join(process.cwd(), "assets", "hills.jpg")), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
