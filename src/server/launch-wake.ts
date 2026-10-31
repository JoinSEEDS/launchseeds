import { mkdirSync, writeFileSync, watch } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
const wakePath = () =>
  join(
    dirname(resolve(process.env.LAUNCHSEEDS_DB_PATH || "./data/launchseeds-v3.sqlite")),
    "launch-wake",
  );
/** Best-effort signal only. Persisted launch rows and short scans recover missed notifications. */
export function notifyLaunchWorker(path = wakePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(Date.now()));
  } catch {
    console.error(
      "Launch wake signal unavailable; worker will recover from persisted state",
    );
  }
}
export function watchLaunchWake(wake: () => void, path = wakePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const watcher = watch(dirname(path), (_event, filename) => {
    if (filename?.toString() === basename(path)) wake();
  });
  watcher.on("error", () =>
    console.error(
      "Launch wake listener unavailable; periodic recovery remains enabled",
    ),
  );
  return () => watcher.close();
}
