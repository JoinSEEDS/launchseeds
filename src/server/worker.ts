import { strategyBoard, hasStrategy } from "../../lib/governance";
import { createMeasure } from "measure-fn";
import type { createLaunchseedsCoreServices } from "../services";
import type { Store } from "./store";
import type { LaunchService } from "./launch";
import { getPublicTreasuryView } from "./treasury-view";

const { measure } = createMeasure("launchseeds:worker");

/**
 * Governance worker. This process has no treasury signing, purchase, burn,
 * or fee-claiming capability. Adding spending requires a dedicated audited
 * executor, rather than a new branch in this worker.
 */
export async function runCycle(input: {
  store: Store;
  services?: ReturnType<typeof createLaunchseedsCoreServices>;
  launch?: LaunchService;
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
    for (const token of input.store.listWork()) {
      if (token.status === "preparing") {
        // Never resume a fundable launch without its immutable first strategy.
        if (input.launch && hasStrategy(token.id))
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
      await attempt(token.id, "strategy takeover", async () => {
        input.services?.governance.refreshLeader(token.id);
      });
      await attempt(token.id, "treasury observation", async () => {
        await getPublicTreasuryView(token.id, {
          checkRpc: true,
          recordObservation: true,
        });
      });
    }
    return { errors };
  });
}
