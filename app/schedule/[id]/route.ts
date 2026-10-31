import { getStore } from "../../../src/server/runtime";

/** Old /schedule/<plan hash> links: a scheduled launch is its coin page,
 * at /coin/<CA> once the CA is published, /coin/<plan hash> until then. */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const id = url.pathname.split("/")[2] || "";
  const plan = /^[a-f0-9]{64}$/.test(id) ? getStore().repo.scheduledPlans.byHash(id) : null;
  const token = plan ? getStore().repo.tokens.get(plan.tokenId) : null;
  const target = token?.mint && token.status === "live" ? token.mint : id;
  return new Response(null, { status: 308, headers: { location: `/coin/${encodeURIComponent(target)}` } });
}
