import {
  ApiError,
  readBoundedJson,
  requireSameOrigin,
} from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { publicRouteError } from "../../../src/server/route-errors";
import { MAX_TOKEN_IMAGE_BYTES } from "../../../lib/media-policy";
import { generateTokenImage } from "../../../src/server/image-generation";

// Each generation is a Codex turn on the server's ChatGPT login; keep it rare.
const limiter = new IngressRateLimiter("image-generate", 5, 3_600_000, 500);
const MAX_WAITING = 4; // one running plus at most three queued
let waiting = 0;
// The name reaches a Codex prompt: plain letters, digits, spaces and . ' - only.
const clean = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N} .'-]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Generates token artwork from the name via Codex (jsx-ai). Returns PNG bytes;
 * nothing is stored until the launch form uploads it like any picked image. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (process.env.LAUNCHSEEDS_IMAGE_GENERATION !== "true")
      throw new ApiError("Image generation is not available.", 503);
    if (!limiter.check(request).allowed)
      throw new ApiError(
        "Image generation limit reached. Try again later.",
        429,
      );
    const body = await readBoundedJson<Record<string, unknown>>(request, 1024);
    const name = clean(body.name, 32);
    const symbol = clean(body.symbol, 10).toUpperCase();
    if (!name) throw new ApiError("Enter a token name first.");
    if (waiting >= MAX_WAITING)
      throw new ApiError(
        "Image generation is busy. Try again in a minute.",
        503,
      );
    waiting++;
    let image: Buffer;
    try {
      image = await generateTokenImage(name, symbol, request.signal);
    } catch (error) {
      console.error(
        "Image generation failed",
        error instanceof Error ? error.message : error,
      );
      throw new ApiError("Image generation failed. Try again.", 502);
    } finally {
      waiting--;
    }
    if (image.length > MAX_TOKEN_IMAGE_BYTES)
      throw new ApiError("Generated image is too large.", 502);
    return new Response(new Uint8Array(image), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    return publicRouteError(error);
  }
}
