import { strategyBoard, hasStrategy } from "../../lib/governance";
import { createMeasure } from "measure-fn";
import type { createLaunchseedsCoreServices } from "../services";
import type { Store } from "./store";
import type { LaunchService } from "./launch";
import { getPublicTreasuryView } from "./treasury-view";
import type { FeeClaimer } from "./fee-claimer";
import type { PackExecutor } from "./pack-executor";
import type { StockExecutor } from "./stock-executor";
import type { MarketMaker } from "./market-maker";
import type { BundleEngine } from "./bundle-engine";
import { marketMakerWalletName } from "./holder-reward-launch";
import { storedLaunchSettings } from "../domain/launch-settings";
import { ensureTokenToken, tokenMint, isTokenToken } from "./token-holders";

const { measure } = createMeasure("launchseeds:worker");

/**
 * Governance worker. It has no treasury signing, purchase or burn capability.
 * The only money-moving step is the dedicated fee claimer (`fees`, enabled by
 * `[launchseeds] fee_claims`), which moves creator fees into the token's own wallet,
 * and the dedicated pack executor (`packs`, `[launchseeds] pack_executions`).
 * Other spending requires its own audited executor, not a new branch here.
 */
export async function runCycle(input: {
  store: Store;
  services?: ReturnType<typeof createLaunchseedsCoreServices>;
  launch?: LaunchService;
  fees?: FeeClaimer;
  packs?: PackExecutor;
  stocks?: StockExecutor;
  market?: MarketMaker;
  /** Sniper-protection bundles ([launchseeds] launch_bundles): fills, exits, sweeps. */
  bundles?: BundleEngine;
}) {
  return measure("worker cycle", async () => {
    const errors: { tokenId: number; operation: string; error: string }[] = [];
    const attempt = async (
      tokenId: number,
      operation: string,
      action: () => Promise<unknown>,
    ) => {
      try {
        await action();
      } catch (error) {
        errors.push({
          tokenId,
          operation,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };
    // $TOKEN holders earn Gravity for sniper-protection rewards. Pump coins
    // (as $TOKEN is) have 6 decimals.
    const token = tokenMint();
    if (input.services && token)
      ensureTokenToken(input.store.repo, { mint: token, decimals: 6 });
    for (const token of input.store.listWork()) {
      if (token.status === "preparing") {
        // Never resume a fundable launch without its immutable first strategy.
        if (
          input.launch &&
          (storedLaunchSettings(token.launchSettingsJson).scheduledAt !==
            null ||
            hasStrategy(token.id))
        )
          await attempt(token.id, "resume preparation", () =>
            input.launch!.resumePreparation(token.id),
          );
        continue;
      }
      if (token.status === "funding" || token.status === "deploying") {
        if (input.launch)
          await attempt(token.id, "launch", () =>
            input.launch!.process(token.id),
          );
        continue;
      }
      if (token.status !== "live") continue;
      if (input.services)
        await attempt(token.id, "holders and Gravity", async () => {
          await input.services!.holders.syncSnapshot(token.id);
          await input.services!.gravity.accrueMinute(token.id);
        });
      // $TOKEN is tracked for its holders' Gravity only.
      if (
        isTokenToken(token) ||
        storedLaunchSettings(token.launchSettingsJson).scheduledAt !== null
      )
        continue;
      await attempt(token.id, "strategy takeover", async () => {
        input.services?.governance.refreshLeader(token.id);
      });
      const rewardsMints = (process.env.LAUNCHSEEDS_REWARDS_MINTS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const rewardsAllowed =
        !rewardsMints.length || rewardsMints.includes(token.mint ?? "");
      if (input.fees && rewardsAllowed)
        await attempt(token.id, "fee claim", async () => {
          const raw = input.store.repo.tokens.get(token.id);
          if (raw) {
            const result = await input.fees!.run(raw);
            if (!result.startsWith("skip:") && result !== "waiting to retry")
              console.log(`Fee claim ${token.mint}: ${result}`);
          }
        });
      if (input.packs && rewardsAllowed)
        await attempt(token.id, "pack execution", async () => {
          const raw = input.store.repo.tokens.get(token.id);
          if (raw) {
            const result = await input.packs!.run(raw);
            if (!result.startsWith("skip:") && result !== "waiting to retry")
              console.log(`Pack execution ${token.mint}: ${result}`);
          }
        });
      if (
        input.market &&
        rewardsAllowed &&
        token.mint &&
        storedLaunchSettings(token.launchSettingsJson).holderRewards
      )
        await attempt(token.id, "market making", async () => {
          const raw = input.store.repo.tokens.get(token.id);
          if (raw) {
            const result = await input.market!.run(
              raw,
              marketMakerWalletName(token.mint),
            );
            if (
              !result.startsWith("skip:") &&
              result !== "holding" &&
              !result.startsWith("waiting")
            )
              console.log(`Market making ${token.mint}: ${result}`);
          }
        });
      if (input.stocks && rewardsAllowed)
        await attempt(token.id, "stock rewards", async () => {
          const raw = input.store.repo.tokens.get(token.id);
          if (raw) {
            const result = await input.stocks!.run(raw);
            if (!result.startsWith("skip:") && result !== "waiting to retry")
              console.log(`Stock rewards ${token.mint}: ${result}`);
          }
        });
      await attempt(token.id, "treasury observation", async () => {
        await getPublicTreasuryView(token.id, {
          checkRpc: true,
          recordObservation: true,
        });
      });
    }
    if (input.bundles)
      await attempt(0, "sniper-protection bundles", async () => {
        for (const line of await input.bundles!.tick(
          (id) => input.store.repo.tokens.get(id) ?? null,
        ))
          if (
            !/holding: not every wallet|waiting for the launch|done$/.test(line)
          )
            console.log(`Bundle ${line}`);
      });
    return { errors };
  });
}
