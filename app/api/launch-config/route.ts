import { apiJson } from "../../../lib/api-security";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { solUsd } from "../../../src/server/solard";
import { getLaunchProvider } from "../../../src/server/runtime";
import { maxBundleLamports, seedBuys, TREASURY_WALLET, treasuryOwed } from "../../../src/server/treasury";
import { creatorVault } from "../../../src/server/coin-fees";
import { unclaimed } from "../../../src/server/fee-claims";
import { getStore } from "../../../src/server/runtime";

/** Configuration and actual operational launch readiness are not synonymous. */
export async function GET(): Promise<Response> {
  const readiness = await getOperationalLaunchReadiness();
  /** What the next launch's bundle buys with: the treasury above its reserve. */
  let seedBundleLamports: number | null = null;
  try {
    const provider = readiness.enabled ? await getLaunchProvider() : null;
    if (provider) {
      const treasury = provider.walletFor(TREASURY_WALLET).address;
      const owed = treasuryOwed(getStore().repo.challenges.owedAll(), unclaimed(BigInt(await provider.balanceLamports(creatorVault(treasury)))));
      const buys = seedBuys(BigInt(await provider.balanceLamports(treasury)), BigInt(readiness.baseFeeLamports ?? 0), maxBundleLamports(), owed);
      seedBundleLamports = buys ? Number(buys.reduce((a, b) => a + b, 0n)) : 0;
    }
  } catch {}
  return apiJson(
    {
      launchEnabled: readiness.enabled,
      baseFeeLamports: readiness.baseFeeLamports,
      configReady: readiness.configReady,
      workerReady: readiness.workerReady,
      rpcReady: readiness.rpcReady,
      checkedAt: readiness.checkedAt,
      imageGeneration: process.env.LAUNCHSEEDS_IMAGE_GENERATION === "true",
      seedBundleLamports,
      solUsd: await solUsd().catch(() => null),
      message: readiness.enabled ? "" : "Launches are temporarily unavailable.",
    },
    200,
    { "cache-control": "no-store" },
  );
}
