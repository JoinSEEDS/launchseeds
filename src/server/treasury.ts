/** The LaunchSeeds treasury: the one server wallet that pays for every launch.
 * It funds the four bundle wallets, creates the coin, and receives each sale's
 * proceeds back, so the next launch can spend them. */
import type { LaunchseedsRepo } from "../db/repo";
import type { Token } from "../db/schema";

export const TREASURY_WALLET = "launchseeds-treasury";
export const isTreasury = (walletName?: string | null) => walletName === TREASURY_WALLET;

/** Bundle wallets per launch: each buys in its own transaction of the bundle. */
export const SEED_WALLETS = 4;
/** Kept back from every bundle for creation, rent and network fees (lamports). */
export const TREASURY_RESERVE_LAMPORTS = 60_000_000n;
/** Each bundle wallet's network and rent reserve (src/server/launch-bundle.ts). */
export const SEED_WALLET_RESERVE_LAMPORTS = 14_000_000n;
export const JITO_TIP = 2_000_000n;
/** Smallest buy one bundle wallet makes. */
export const MIN_SEED_BUY_LAMPORTS = 30_000_000n;

/** Each bundle wallet's buy: the configured bundle size, or less when the
 * treasury can't cover it. Never spends the reserve or SOL owed to coins'
 * bounty pools. Split evenly in whole lamports; null when too little is left. */
export function seedBuys(treasuryLamports: bigint, baseFeeLamports: bigint, maxBundleLamports: bigint, owedLamports = 0n): bigint[] | null {
  const spendable = treasuryLamports - owedLamports - TREASURY_RESERVE_LAMPORTS - baseFeeLamports - JITO_TIP - SEED_WALLET_RESERVE_LAMPORTS * BigInt(SEED_WALLETS);
  const bundle = spendable < maxBundleLamports ? spendable : maxBundleLamports;
  const each = bundle / BigInt(SEED_WALLETS);
  if (each < MIN_SEED_BUY_LAMPORTS) return null;
  return Array.from({ length: SEED_WALLETS }, () => each);
}

type TreasuryRepo = Pick<LaunchseedsRepo, "tokens" | "userBatches">;
/** Bundle columns whose SOL is on its way: buying, or a sale or payout in flight. */
const IN_FLIGHT = new Set(["buying", "exiting", "exited", "settling"]);

/** A launch is using the treasury while it is being created or bought, and
 * while a sale and its payout are in flight. Columns that simply hold (waiting
 * for their sell rule, maybe for days) do not block the next launch; it spends
 * only what the treasury actually has. */
export function launchHoldsTreasury(repo: TreasuryRepo, token: Token) {
  if (token.status === "preparing" || token.status === "funding" || token.status === "deploying") return true;
  if (token.status !== "live") return false;
  return repo.userBatches.byToken(token.id).some((row) => IN_FLIGHT.has((JSON.parse(row.stateJson) as { status: string }).status));
}

/** One launch at a time: the next one waits for the last bundle's proceeds. */
export const treasuryBusy = (repo: TreasuryRepo) =>
  repo.tokens.byFundingWalletName(TREASURY_WALLET).some((token) => launchHoldsTreasury(repo, token));

const DAY_MS = 86_400_000;
/** Why a wallet may not launch now, or null: at most `perWallet` launches per
 * wallet and `daily` for everyone in 24 hours. Failed launches count too. */
export function seedLimit(tokens: Pick<Token, "createdAt" | "status" | "creatorWallet">[], wallet: string, now: number, daily: number, perWallet = 5) {
  const recent = tokens.filter((t) => t.createdAt > now - DAY_MS);
  if (recent.filter((t) => t.creatorWallet === wallet).length >= perWallet) return `This wallet already launched ${perWallet} ${perWallet === 1 ? "coin" : "coins"} today. Try again tomorrow.`;
  if (recent.length >= daily) return "Today's launches are used up. Try again tomorrow.";
  return null;
}

/** What the treasury lost on launches in the last 24 hours: each finished
 * bundle's buys minus what its sale paid back (lamports). */
export function dailyLoss(repo: TreasuryRepo, now: number) {
  let loss = 0n;
  for (const token of repo.tokens.byFundingWalletName(TREASURY_WALLET)) {
    if (token.createdAt <= now - DAY_MS) continue;
    for (const row of repo.userBatches.byToken(token.id)) {
      const s = JSON.parse(row.stateJson) as { status: string; buyCostLamports?: string; paidLamports?: string | null };
      if (s.status === "settled") loss += BigInt(s.buyCostLamports ?? "0") - BigInt(s.paidLamports ?? "0");
    }
  }
  return loss;
}

const sol = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e9)) : 0n;
};
/** LAUNCHSEEDS_MAX_BUNDLE_SOL: the most one launch's bundle buys. 0 when unset: no launches. */
export const maxBundleLamports = (env: NodeJS.ProcessEnv = process.env) => sol(env.LAUNCHSEEDS_MAX_BUNDLE_SOL);
/** LAUNCHSEEDS_SEEDS_BUNDLE_SOL: the $SEEDS launch's bundle; unset: the same cap as every launch. */
export const seedsBundleLamports = (env: NodeJS.ProcessEnv = process.env) => sol(env.LAUNCHSEEDS_SEEDS_BUNDLE_SOL);
/** LAUNCHSEEDS_DAILY_LOSS_SOL: launches pause once the last 24 hours lost this much. 0 when unset: no limit. */
export const dailyLossLimit = (env: NodeJS.ProcessEnv = process.env) => sol(env.LAUNCHSEEDS_DAILY_LOSS_SOL);
