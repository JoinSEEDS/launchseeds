import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
export const solAmount = (lamports: string) =>
  (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });
const sol = (lamports: bigint | string) => (Number(lamports) / 1e9).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const tx = (signature: string, label: string) => <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">{label}</a>;

/** A launch's published plan in a few facts: when, the treasury's bundle, its
 * staggered sells and where the coin's fees go. Refreshed while it runs. */
export function ScheduledPlan({ plan }: { plan: ScheduledLaunchView }) {
  const runs = plan.batchRuns, wallets = plan.userBatches?.columns.length ?? runs.length;
  const sold = runs.filter((r) => r.saleSignature), returned = sold.reduce((n, r) => n + BigInt(r.netSaleLamports ?? "0"), 0n);
  const sells = plan.userBatches?.columns.map((b) => (b.exit.kind === "after" ? `${b.exit.seconds}s` : null)).filter(Boolean) ?? [];
  return (
    <dl className="facts small">
      <div><dt>Launch (UTC)</dt><dd className="mono" style={{ fontSize: "13px", fontWeight: 500 }}>{new Date(plan.scheduledAt).toISOString().slice(0, 16).replace("T", " ")}</dd></div>
      <div><dt>Bundle</dt><dd>{sol(plan.totalLamports)} SOL · {wallets} wallets</dd></div>
      {sells.length ? <div><dt>Sells after buys</dt><dd>{sells.join(", ")}</dd></div> : null}
      {runs.length ? <div><dt>Sold</dt><dd className={sold.length === runs.length ? "good" : ""}>{sold.length} / {runs.length}{sold.length ? ` · ${sol(returned)} SOL back` : ""}</dd></div> : null}
      <div><dt>Fees go to</dt><dd className="good">Treasury</dd></div>
      {plan.launchSignature ? <div><dt>Launch</dt><dd>{tx(plan.launchSignature, "View tx")}</dd></div> : null}
    </dl>
  );
}
