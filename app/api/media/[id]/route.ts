import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function GET(req: Request) {
  const file = new URL(req.url).pathname.split("/").at(-1) || "";
  if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(file))
    return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(
      resolve(process.env.LAUNCHSEEDS_ASSETS_PATH || "./data/assets", file),
    );
    const ext = file.split(".").at(-1),
      type =
        ext === "jpg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "gif"
              ? "image/gif"
              : "image/webp";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
