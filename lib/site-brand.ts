export type SiteBrand = {
  kind: "launchseeds" | "launchseeds";
  name: string;
  ca: string | null;
  visibleSince: number | null;
};
export const LAUNCHSEEDS_BRAND: SiteBrand = { kind: "launchseeds", name: "LaunchSeeds", ca: null, visibleSince: null };
export function launchseedsHost(host: string | null) {
  const name = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return name === "launchseeds.xyz" || name === "www.launchseeds.xyz" ? name : null;
}
export function brandForHost(host: string | null, env: NodeJS.ProcessEnv = process.env): SiteBrand {
  if (!launchseedsHost(host)) return LAUNCHSEEDS_BRAND;
  const date = Date.parse(env.LAUNCHSEEDS_VISIBLE_SINCE ?? "");
  const ca = env.LAUNCHSEEDS_CA?.trim();
  return { kind: "launchseeds", name: "LaunchSeeds", ca: ca && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca) ? ca : null, visibleSince: Number.isFinite(date) ? date : null };
}
/** Additional origins are accepted only when the request is for that exact host. */
export function expectedRequestOrigin(request: Request, publicBase?: string) {
  const host = launchseedsHost(request.headers.get("host") ?? new URL(request.url).host);
  return host ? `https://${host}` : publicBase ? new URL(publicBase).origin : new URL(request.url).origin;
}
