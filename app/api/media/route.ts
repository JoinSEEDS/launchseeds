import { MAX_TOKEN_IMAGE_BYTES, TOKEN_IMAGE_SIZE_ERROR } from "../../../lib/media-policy";
import { requireSameOrigin, ApiError } from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const max = MAX_TOKEN_IMAGE_BYTES;
// Abuse protections at a trusted proxy are still required in production.
// Do not rate-limit based on user-controlled X-Forwarded-For values.
const uploads = new IngressRateLimiter("media", 10, 600_000);
const mimeTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
function actualMime(buf: Uint8Array) {
  const h = Buffer.from(buf);
  if (h.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (h[0] === 255 && h[1] === 216 && h[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(h.subarray(0, 6).toString()))
    return "image/gif";
  if (
    h.subarray(0, 4).toString() === "RIFF" &&
    h.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof ApiError ? error.message : "Origin not allowed",
      },
      { status: 403 },
    );
  }
  let limited;
  try {
    limited = uploads.check(req);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : "Rate limit configuration unavailable",
      },
      { status: error instanceof ApiError ? error.status : 503 },
    );
  }

  if (!limited.allowed)
    return Response.json(
      { error: "Too many image uploads" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      },
    );
  const mime = req.headers.get("content-type") || "";
  if (!mimeTypes.includes(mime as any))
    return Response.json(
      { error: "Choose PNG, JPEG, GIF or WebP" },
      { status: 415 },
    );
  if (Number(req.headers.get("content-length") || 0) > max)
    return Response.json({ error: TOKEN_IMAGE_SIZE_ERROR }, { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) return Response.json({ error: "Empty image" }, { status: 400 });
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > max) {
        await reader.cancel();
        return Response.json(
          { error: TOKEN_IMAGE_SIZE_ERROR },
          { status: 413 },
        );
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
  if (!length || actualMime(body) !== mime)
    return Response.json({ error: "Invalid image bytes" }, { status: 400 });
  const hash = createHash("sha256").update(body).digest("hex"),
    ext =
      mime === "image/png"
        ? "png"
        : mime === "image/jpeg"
          ? "jpg"
          : mime === "image/gif"
            ? "gif"
            : "webp";
  const folder = resolve(process.env.LAUNCHSEEDS_ASSETS_PATH || "./data/assets");
  await mkdir(folder, { recursive: true });
  const maxAssets = Math.max(
    1,
    Math.min(100_000, Number(process.env.LAUNCHSEEDS_MAX_ASSETS || 1000) || 1000),
  );
  const entries = await readdir(folder);
  if (entries.length >= maxAssets && !entries.includes(`${hash}.${ext}`))
    return Response.json(
      { error: "Asset storage capacity reached" },
      { status: 503 },
    );
  await writeFile(resolve(folder, `${hash}.${ext}`), body, {
    flag: "wx",
  }).catch((e: { code?: string }) => {
    if (e.code !== "EEXIST") throw e;
  });
  return Response.json(
    { image: `/api/media/${hash}.${ext}` },
    { headers: { "cache-control": "no-store" } },
  );
}
