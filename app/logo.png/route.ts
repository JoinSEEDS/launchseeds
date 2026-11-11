import { join } from "node:path";

/** The LaunchSeeds logo image, served from assets/. */
export function GET() {
  return new Response(Bun.file(join(process.cwd(), "assets", "logo.png")), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
