import { createMeasure } from "measure-fn";
import type { Store } from "./store";
import type { LaunchService } from "./launch";
import { storedLaunchSettings } from "../domain/launch-settings";

const { measure } = createMeasure("launchseeds:worker");

/** One worker cycle: prepare and launch scheduled coins, then run each launch's
 * bundle columns and tranches (buys, exits, payouts). */
export async function runCycle(input: {
  store: Store;
  launch?: LaunchService;
  /** Launch bundles ([launchseeds] launch_bundles): fills, exits, payouts. */
  bundles?: { tick(): Promise<string[]> };
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
    if (input.bundles)
      await attempt(0, "launch bundles", async () => {
        for (const line of await input.bundles!.tick())
          if (!/holding: not every wallet|waiting for the launch|done$/.test(line)) console.log(`Bundle ${line}`);
      });
    return { errors };
  });
}
