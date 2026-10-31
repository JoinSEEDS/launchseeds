/** Canonical public page used as the Website of every LaunchSeeds launch. */
export const COIN_ORIGIN = "https://launchseeds.xyz";
export const coinPath = (mint: string) => `/coin/${encodeURIComponent(mint)}`;
export const coinWebsite = (mint: string) => COIN_ORIGIN + coinPath(mint);
