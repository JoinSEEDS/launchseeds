import { AsyncLocalStorage } from "node:async_hooks";
import { brandForHost, LAUNCHSEEDS_BRAND, type SiteBrand } from "../../lib/site-brand";
import type { Token } from "../db/schema";
import { storedLaunchSettings } from "../domain/launch-settings";

const urls = ((globalThis as typeof globalThis & { __launchseedsRequestUrls?: AsyncLocalStorage<string> }).__launchseedsRequestUrls ??= new AsyncLocalStorage<string>());
export const currentRequestUrl = () => urls.getStore();
const shared = globalThis as typeof globalThis & { __launchseedsBrandContext?: AsyncLocalStorage<SiteBrand> };
const context = shared.__launchseedsBrandContext ??= new AsyncLocalStorage<SiteBrand>();
export const currentBrand = () => context.getStore() ?? LAUNCHSEEDS_BRAND;
export function runWithBrand<T>(brand: SiteBrand, task: () => T): T { return context.run(brand, task); }
export function runForSite<T>(request: Request, task: () => T): T {
  return urls.run(request.url, () => runWithBrand(brandForHost(request.headers.get("host") ?? new URL(request.url).host), task));
}
export function tokenVisible(token: Pick<Token, "createdAt" | "launchedAt" | "status" | "symbol" | "launchSettingsJson">, brand = currentBrand()) {
  if (brand.kind !== "launchseeds") return true;
  if (brand.visibleSince === null || (token.status === "live" ? token.launchedAt ?? token.createdAt : token.createdAt) < brand.visibleSince) return false;
  const settings = storedLaunchSettings(token.launchSettingsJson);
  // LaunchSeeds exposes the new scheduled product, not legacy ecosystem raffles.
  return token.symbol.toUpperCase() !== "TOKEN" && settings.scheduledAt !== null && (settings.profitPolicy?.mode === "burn" || settings.profitPolicy?.mode === "wallet");
}
export function sitePathAllowed(path: string, brand = currentBrand()) {
  return brand.kind !== "launchseeds" || !/^\/(?:token|wallet|admin|site)(?:\/|$)|^\/api\/(?:token|wallet|admin|site|strategies|packs|treasury)(?:\/|$)/.test(path);
}
