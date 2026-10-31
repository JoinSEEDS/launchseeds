import { reservedMint } from "./reserved-mint";
import type { LaunchSettings } from "./launch-settings";
/** Stable public payload whose JSON bytes are hashed and can be recomputed. */
export function scheduledCommitment(
  token: {
    mint?: string | null;
    mintSignerRef?: string | null;
    description?: string;
    name: string;
    symbol: string;
    image: string;
  },
  settings: LaunchSettings,
  buyers: Array<{
    wallet: string;
    budgetLamports: string;
  }>,
) {
  return {
    version: settings.userBatches ? 4 : settings.publishProject ? 3 : settings.publishMint ? 2 : 1,
    ...(settings.userBatches ? {fundingModel:"user-funded-batches",batches:settings.userBatches,sellFeeCapLamports:"100000",settlementFeeCapLamports:"100000"} : {}),
    ...(settings.publishProject ? {description:token.description ?? ""} : {}),
    ...(settings.publishMint ? { mint: reservedMint(token), feesTo: settings.feesTo } : {}),
    ...(settings.boost ? { boost: settings.boost } : {}),
    tradingFees: settings.publishMint && !settings.holderRewards ? "Creator fees to published wallet" : "Pump holder rewards",
    name: token.name,
    symbol: token.symbol,
    image: token.image,
    scheduledAt: settings.scheduledAt,
    bundleLamports: settings.bundleLamports,
    walletSharesBps: settings.walletSharesBps,
    exitPercent: settings.bundleExitPercent,
    profitPolicy: settings.profitPolicy,
    wallets: buyers.map((b) => ({
      ...("batchIndex" in b ? {batchIndex:b.batchIndex} : {}),
      ...("role" in b && b.role ? {role:b.role} : {}),
      wallet: b.wallet,
      budgetLamports: b.budgetLamports,
    })),
  };
}
