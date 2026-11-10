import { UserBatchesPlan } from "./user-batches-plan";
import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
export const solAmount = (lamports: string) =>
  (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });
/** A launch's published plan: its columns and tranches. */
export function ScheduledPlan({ plan }: { plan: ScheduledLaunchView }) {
  return plan.userBatches ? <UserBatchesPlan plan={plan} /> : null;
}
