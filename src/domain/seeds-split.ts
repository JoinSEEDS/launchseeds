/** $SEEDS is LaunchSeeds' own coin. It has no challenges; instead it gets a
 * share of every other coin's creator fees, and all of its own. That SOL stays
 * in the treasury until an admin spends it buying back and burning $SEEDS. */
export const SEEDS_SYMBOL = "SEEDS";
export const DEFAULT_SEEDS_SHARE_BPS = 1000; // 10%

/** The $SEEDS share of each coin's fees, in basis points (0–5000). */
export function seedsShareBps(env: Record<string, string | undefined> = process.env) {
  const raw = env.LAUNCHSEEDS_SEEDS_SHARE_BPS;
  const n = raw === undefined || raw === "" ? DEFAULT_SEEDS_SHARE_BPS : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 5000) throw new Error("LAUNCHSEEDS_SEEDS_SHARE_BPS must be 0–5000");
  return n;
}
/** The vanity mint set aside for $SEEDS before launch (scripts/reserve-seeds-mint.ts). */
export const seedsReservedMint = (env: Record<string, string | undefined> = process.env) => env.LAUNCHSEEDS_SEEDS_RESERVED_MINT?.trim() || null;
/** The $SEEDS mint: set in config, or the one reserved for its launch. */
export const seedsMint = (env: Record<string, string | undefined> = process.env) => env.LAUNCHSEEDS_SEEDS_MINT?.trim() || seedsReservedMint(env);
/** Tickers only an admin may launch. */
export const isSeedsSymbol = (symbol: string) => symbol.trim().replace(/^\$/, "").toUpperCase() === SEEDS_SYMBOL;
/** The $SEEDS cut of one coin's fees; the coin keeps the rest for its challenges. */
export const seedsCut = (lamports: bigint, bps: number) => (lamports * BigInt(bps)) / 10_000n;
