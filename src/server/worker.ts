import { createMeasure } from "measure-fn";
import type { Store } from "./store";
import type { LaunchService } from "./launch";
import { storedLaunchSettings } from "../domain/launch-settings";
import { isTreasury } from "./treasury";

const { measure } = createMeasure("launchseeds:worker");

/** One worker cycle: prepare and launch scheduled coins, then run each launch's
 * bundle columns and tranches (buys, exits, payouts). */
export async function runCycle(input: {
  store: Store;
  launch?: LaunchService;
  /** Launch bundles ([launchseeds] launch_bundles): fills, exits, payouts. */
  bundles?: { tick(): Promise<string[]> };
  /** Each live coin's creator fees, and claiming the treasury's vault. */
  fees?: { sync(token: { id: number; mint: string }): Promise<number>; claim(): Promise<string> };
}) {
  return measure("worker cycle", async () => {
    const errors: { tokenId: number; operation: string; error: string }[] = [];
    const attempt = async (tokenId: number, operation: string, action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        errors.push({ tokenId, operation, error: error instanceof Error ? error.message : "Unknown error" });
      }
    };
    for (const token of input.store.listWork()) {
      if (token.status === "preparing") {
        if (input.launch && storedLaunchSettings(token.launchSettingsJson).scheduledAt !== null)
          await attempt(token.id, "resume preparation", () => input.launch!.resumePreparation(token.id));
        continue;
      }
      if ((token.status === "funding" || token.status === "deploying") && input.launch)
        await attempt(token.id, "launch", () => input.launch!.process(token.id));
    }
    if (input.fees) {
      for (const token of input.store.listLive())
        if (token.mint && isTreasury(token.fundingWalletName))
          await attempt(token.id, "coin fees", () => input.fees!.sync({ id: token.id, mint: token.mint }));
      await attempt(0, "fee claim", async () => {
        const line = await input.fees!.claim();
        if (line !== "nothing to claim") console.log(`Fees: ${line}`);
      });
    }
    if (input.bundles)
      await attempt(0, "launch bundles", async () => {
        for (const line of await input.bundles!.tick())
          if (!/holding: not every wallet|waiting for the launch|done$/.test(line)) console.log(`Bundle ${line}`);
      });
    return { errors };
  });
}
