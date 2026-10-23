import { apiJson } from "../../../lib/api-security";

/** Health does not start workers, access secrets or perform a database write. */
export function GET(): Response {
  const launchEnabled =
    process.env.LAUNCHSEEDS_LAUNCH_ENABLED === "true" &&
    process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true" &&
    process.env.LAUNCHSEEDS_WORKER_ENABLED === "true";
  return apiJson({ ok: true, launchEnabled, workersStartedByWeb: false });
}
