import "../src/server/rpc-pacing-install";
import { runForSite, sitePathAllowed, currentBrand, tokenVisible } from "../src/server/site-brand";
import { getStore } from "../src/server/runtime";
import { createAppRouter, builtAssets } from "tradjs/server";
import { localIngress } from "../src/server/local-ingress";
import { ensureWorker } from "../src/server/worker-supervisor";
import { siteForHost, siteRedirectTarget } from "../src/server/token-site";
if (!process.env.LAUNCHSEEDS_DB_PATH)
  throw new Error(
    "Load .config.toml through bgrun before starting the local runtime",
  );
const handler = createAppRouter();
const port = Number(process.argv[2] || 3010);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(request, server) {
    try {
      const peer = server.requestIP(request)?.address ?? null;
      // A token's own domain: "/" is its site, API and media stay on this app,
      // anything else belongs to LaunchSeeds itself.
      const site = siteForHost(request.headers.get("host"));
      if (site) {
        const url = new URL(request.url);
        if (url.pathname === "/")
          request = new Request(
            new URL(`/site/${site.slug}${url.search}`, url),
            request,
          );
        else if (!/^\/(api|media)\//.test(url.pathname)) {
          const base = process.env.PUBLIC_BASE_URL;
          return base
            ? Response.redirect(siteRedirectTarget(url.href, base), 302)
            : new Response("Not found", { status: 404 });
        }
      }
      const trusted = localIngress(request, peer);
      const path = new URL(trusted.url).pathname;
      // Built CSS/JS names carry a content hash, so a changed file gets a new URL.
      const asset = builtAssets[path];
      if (asset) {
        if (!["GET", "HEAD"].includes(trusted.method))
          return new Response("Method not allowed", { status: 405 });
        return new Response(trusted.method === "HEAD" ? null : asset.content, {
          headers: {
            "content-type": asset.contentType,
            "cache-control": /-[a-z0-9]{8}\.(css|js)$/.test(path)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
            "x-content-type-options": "nosniff",
          },
        });
      }
      const result = await runForSite(trusted, async () => {
        if (!sitePathAllowed(path)) return new Response("Not found", { status: 404 });
        const handle = /^\/api\/launches\/([^/]+)$/.exec(path)?.[1];
        if (currentBrand().kind === "launchseeds" && handle) {
          const token = getStore().repo.tokens.getByHandle(handle);
          if (!token || !tokenVisible(token)) return new Response("Not found", { status: 404 });
        }
        return handler(trusted);
      });
      if (result instanceof Response) {
        const headers = new Headers(result.headers);
        headers.set("cache-control", "no-store");
        headers.append("vary", "Host");
        return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
      }
      return new Response(typeof result === "string" ? result : JSON.stringify(result));
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Local request failed",
      );
      return new Response("Request unavailable", { status: 503 });
    }
  },
});
console.log(`LaunchSeeds local runtime: http://localhost:${server.port}`);
ensureWorker().then(
  (worker) =>
    worker &&
    console.log(
      `LaunchSeeds worker ${worker.status} (pid ${worker.pid ?? "-"}) via bgrun`,
    ),
  (error) =>
    console.error(
      "LaunchSeeds worker autostart failed:",
      error instanceof Error ? error.message : error,
    ),
);
