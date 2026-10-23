import { strategyBoard, hasStrategy } from "../../lib/governance";
import { createMeasure } from "measure-fn";
import type { SolardSource } from "./solard";
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
  source?: SolardSource;
  launch?: LaunchService;
}) {
  return measure("worker cycle", async () => {
    const errors: { uid: string; operation: string; error: string }[] = [];
    const attempt = async (
      uid: string,
      operation: string,
      action: () => Promise<unknown>,
    ) => {
      try {
        await action();
      } catch (error) {
        errors.push({
          uid,
          operation,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };
    for (const request of input.store.repo.operations.pendingLaunches()) {
      if (input.launch && hasStrategy(request.uid))
        await attempt(request.uid, "resume preparation", () =>
          input.launch!.resumePreparation(request.uid),
        );
    }
    for (const token of input.store.listWork()) {
      if (token.status === "preparing") {
        // Never resume a fundable launch without its immutable first strategy.
        if (input.launch && hasStrategy(token.uid))
          await attempt(token.uid, "resume preparation", () =>
            input.launch!.resumePreparation(token.uid),
          );
        continue;
      }
      if (token.status === "funding" || token.status === "deploying") {
        if (input.launch)
          await attempt(token.uid, "launch", () =>
            input.launch!.process(token.uid),
          );
        continue;
      }
      if (token.status !== "live") continue;
      if (input.source)
        await attempt(token.uid, "gravity", async () => {
          const data = await input.source!.sample(
            token.mint,
            (process.env.LAUNCHSEEDS_EXCLUDED_WALLETS || "")
              .split(",")
              .filter(Boolean),
          );
          input.store.applySnapshot(token.id, data.snapshot, data.priceUsd);
        });
      await attempt(token.uid, "strategy takeover", async () => {
        strategyBoard(token.uid);
      });
      await attempt(token.uid, "treasury observation", async () => {
        await getPublicTreasuryView(token.uid, {
          checkRpc: true,
          recordObservation: true,
        });
      });
    }
    return { errors };
  });
}
