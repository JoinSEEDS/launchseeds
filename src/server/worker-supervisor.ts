/** Web startup keeps the single LaunchSeeds worker alive through the bgrun SDK.
 * `ensure` is idempotent: a running worker with the same definition is left
 * untouched, a missing/stopped/changed one is (re)started under bgrun.
 */
import { resolve } from "node:path";

export const WORKER_PROCESS = "launchseeds-worker";
export const WORKER_COMMAND = "bun run scripts/worker.ts";

type Ensure = (options: {
  name: string;
  command: string;
  cwd: string;
  config: string;
  detached: boolean;
}) => Promise<{ status: string; pid: number | null }>;

export async function ensureWorker(
  env: NodeJS.ProcessEnv = process.env,
  ensure?: Ensure,
  cwd = resolve(import.meta.dir, "../.."),
) {
  if (env.LAUNCHSEEDS_WORKER_ENABLED !== "true") return null;
  const run = ensure ?? (await import("bgrun")).ensure;
  // Detached: restarting the web process must not stop an in-flight worker cycle.
  return run({
    name: WORKER_PROCESS,
    command: WORKER_COMMAND,
    cwd,
    config: resolve(cwd, ".config.toml"),
    detached: true,
  });
}
