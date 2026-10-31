import { mountLaunchCountdown } from "./launch-countdown";
import { render } from "tradjs/client";
import { ScheduledPlan } from "../app/components/scheduled-plan";
import type { ScheduledLaunchView } from "../src/server/scheduled-launches";
import { SequentialPoller, getJson } from "./client-request";
export function mountScheduledPlan() {
  const page = document.querySelector<HTMLElement>("[data-scheduled-plan]"),
    root = document.getElementById("scheduled-plan-root");
  if (!page || !root) return;
  let stopped = false;
  const stopCountdown = mountLaunchCountdown(page);
  const poller = new SequentialPoller(async (signal) => {
    if (document.hidden) return;
    const plan = await getJson<ScheduledLaunchView>(
      `/api/schedules/${page.dataset.scheduledPlan}`,
      { signal },
    );
    if (!stopped) {
      if (page.dataset.coinStatus && page.dataset.coinStatus !== "live" && plan.status === "live") { location.replace(plan.mint ? `/coin/${plan.mint}` : location.href); return; }
      render(<ScheduledPlan plan={plan} />, root);
    }
  }, 5000);
  poller.start();
  return () => {
    stopped = true;
    stopCountdown();
    poller.stop();
    render(null, root);
  };
}
