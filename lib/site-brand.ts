export type SiteBrand = {
  kind: "launchseeds" | "launchseeds" | "launchseeds";
  name: string;
  ca: string | null;
  visibleSince: number | null;
};
export const LAUNCHSEEDS_BRAND: SiteBrand = { kind: "launchseeds", name: "LaunchSeeds", ca: null, visibleSince: null };
const hostName = (host: string | null) => (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
export function launchseedsHost(host: string | null) {
  const name = hostName(host);
  return name === "launchseeds.xyz" || name === "www.launchseeds.xyz" ? name : null;
}
/** LaunchSeeds answers on the exact hosts listed in LAUNCHSEEDS_HOSTS (comma separated). */
export function launchseedsHost(host: string | null, env: NodeJS.ProcessEnv = process.env) {
  const name = hostName(host);
  const hosts = (env.LAUNCHSEEDS_HOSTS ?? "").split(",").map((h) => hostName(h)).filter(Boolean);
  return name && hosts.includes(name) ? name : null;
}
export function brandForHost(host: string | null, env: NodeJS.ProcessEnv = process.env): SiteBrand {
  if (launchseedsHost(host, env)) return { kind: "launchseeds", name: "LaunchSeeds", ca: null, visibleSince: null };
  if (!launchseedsHost(host)) return LAUNCHSEEDS_BRAND;
  const date = Date.parse(env.LAUNCHSEEDS_VISIBLE_SINCE ?? "");
  const ca = env.LAUNCHSEEDS_CA?.trim();
  return { kind: "launchseeds", name: "LaunchSeeds", ca: ca && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca) ? ca : null, visibleSince: Number.isFinite(date) ? date : null };
}
/** Additional origins are accepted only when the request is for that exact host. */
export function expectedRequestOrigin(request: Request, publicBase?: string) {
  const requested = request.headers.get("host") ?? new URL(request.url).host;
  const host = launchseedsHost(requested) ?? launchseedsHost(requested);
  return host ? `https://${host}` : publicBase ? new URL(publicBase).origin : new URL(request.url).origin;
}
