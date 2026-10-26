import { ApiError, readBoundedJson } from "../../../../lib/api-security";
import {
  AdminHttpError,
  adminError,
  enforceAdminAction,
  hasAdminApiKey,
} from "../../../../lib/admin/security";
import { IngressRateLimiter } from "../../../../lib/trusted-client";
import { generateTokenImage } from "../../../../src/server/image-generation";

// Shares the server's Codex login with the public generator; keep a ceiling.
const limiter = new IngressRateLimiter("admin-image", 30, 3_600_000, 50);

/**
 * Admin image generation through the same Codex runtime as the launch form.
 * Auth: `Authorization: Bearer <admin_api_key>` (scripts) or the admin session.
 * Body: `{ name, symbol?, prompt?, styleReference? }` → image/png.
 * `prompt` replaces the token-icon prompt; the style reference stays attached
 * unless `styleReference: false`.
 *
 *   curl -X POST https://launchseeds.xyz/api/admin/image \
 *     -H "authorization: Bearer $KEY" -H "content-type: application/json" \
 *     -d '{"name":"Example Coin","symbol":"COIN"}' -o icon.png
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // Browser sessions use the usual same-origin admin action checks.
    if (!hasAdminApiKey(request)) enforceAdminAction(request);
    if (!limiter.check(request).allowed) throw new AdminHttpError("Image limit reached. Try again later.", 429);
    const body = await readBoundedJson<Record<string, unknown>>(request, 8192);
    const text = (value: unknown, max: number) =>
      typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
    const name = text(body.name, 64);
    const prompt = text(body.prompt, 4000);
    if (!name && !prompt) throw new AdminHttpError("Send a name or a prompt.", 400);
    let image: Buffer;
    try {
      image = await generateTokenImage(name || "artwork", text(body.symbol, 16).toUpperCase(), request.signal, {
        prompt: prompt || undefined,
        styleReference: body.styleReference !== false,
      });
    } catch (error) {
      console.error("Admin image generation failed", error instanceof Error ? error.message : error);
      throw new AdminHttpError("Image generation failed. Try again.", 502);
    }
    return new Response(new Uint8Array(image), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ApiError) return adminError(new AdminHttpError(error.message, error.status));
    return adminError(error);
  }
}
