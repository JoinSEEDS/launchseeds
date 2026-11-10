import { render } from "tradjs/client";
import { CoinActivity, type Activity } from "../app/components/coin-activity";
import { SequentialPoller, getJson } from "./client-request";

/** Live scheduled coin: trades refresh every 10 seconds. */
export function mountCoinActivity() {
  const page = document.querySelector<HTMLElement>("[data-coin-mint]");
  const root = document.getElementById("coin-activity-root");
  const mint = page?.dataset.coinMint;
  if (!page || !root || !mint) return () => {};
  let labels: Record<string, string> = {};
  try { labels = JSON.parse(page.dataset.coinLabels ?? "{}"); } catch {}
  let stopped = false;
  const poller = new SequentialPoller(async (signal) => {
    if (document.hidden) return;
    const activity = await getJson<Activity>(`/api/tokens/${encodeURIComponent(mint)}/activity`, { signal });
    if (!stopped) render(<CoinActivity activity={activity} labels={labels} />, root);
  }, 10_000);
  poller.start();
  return () => { stopped = true; poller.stop(); };
}
