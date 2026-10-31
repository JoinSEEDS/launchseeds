import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
import { shortAddress } from "../../lib/format";

const sol = (lamports: string | number) => (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 3 });
const utc = (at: number) => new Date(at).toISOString().slice(11, 16) + " UTC";
const account = (wallet: string, text = shortAddress(wallet)) => (
  <a className="mono" href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener noreferrer">{text}</a>
);
const tx = (signature: string, text: string) => (
  <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">{text} ↗</a>
);
const STATUS: Record<string, [string, string]> = {
  buying: ["Buying", "wait"], holding: ["Holding", "wait"], exiting: ["Selling", "wait"], exited: ["Sold", "ok"],
  settling: ["Paying out", "ok"], settled: ["Paid", "ok"], review: ["Review", "bad"],
};

/** A user-funded launch's columns: one compact card per bundle transaction. */
export function UserBatchesPlan({ plan }: { plan: ScheduledLaunchView }) {
  const batches = plan.userBatches!;
  return (
    <section className="panel coin-columns" aria-label="Launch columns">
      <div className="panel__head">
        <span className="label">Columns</span>
        <span className="dim">{sol(plan.totalLamports)} SOL · {plan.wallets.length} wallets</span>
      </div>
      <div className="coin-columns__grid">
        {batches.columns.map((column, index) => {
          const run = plan.batchRuns.find((row) => row.batchIndex === index);
          const wallets = plan.wallets.filter((wallet) => wallet.batchIndex === index);
          const signer = wallets.find((wallet) => wallet.role === "signer");
          const [label, tone] = run ? (STATUS[run.status] ?? [run.status, "wait"]) : ["Scheduled", "wait"];
          const cost = run ? Number(run.buyCostLamports) : 0;
          const result = run?.netSaleLamports && cost > 0 ? (Number(run.netSaleLamports) / cost - 1) * 100 : null;
          const rule = column.exit.kind === "profit" ? `+${column.exit.profitBps / 100}%` : column.exit.kind === "time" ? utc(column.exit.at) : "Instant";
          return (
            <article className="coin-column">
              <header className="coin-column__head">
                <b>Column {index + 1}</b>
                {signer?.name ? <span className="mono dim">{signer.name}</span> : null}
                <span className={`coin-status coin-status--${tone}`}>{label}</span>
              </header>
              <div className="coin-column__rule" title={column.exit.kind === "profit" ? "Sells at this net profit, after costs" : column.exit.kind === "time" ? "Sells at this time" : "Sells once its buys confirm"}>
                <span className="dim">Sells at</span> <strong>{rule}</strong>
              </div>
              <ul className="coin-column__wallets">
                {wallets.map((wallet) => <li>{account(wallet.wallet)}<span>{sol(wallet.budgetLamports)}</span></li>)}
              </ul>
              <footer className="coin-column__foot">
                {result !== null ? <span className={result >= 0 ? "up" : "down"}>{result >= 0 ? "+" : ""}{result.toFixed(1)}%</span> : null}
                {run?.paidLamports ? <span>paid {sol(run.paidLamports)}</span> : null}
                {run?.saleSignature ? tx(run.saleSignature, "sale") : null}
                {run?.payoutSignature ? tx(run.payoutSignature, "payout") : null}
              </footer>
            </article>
          );
        })}
      </div>
      <div className="coin-columns__meta">
        <span><span className="dim">Proceeds</span> {account(batches.proceedsWallet)}</span>
        <span><span className="dim">Fees</span> {plan.holderRewards ? "holders" : plan.feesTo ? account(plan.feesTo) : "—"}</span>
        {plan.launchSignature ? tx(plan.launchSignature, "launch") : null}
        <a href={`/api/schedules/${plan.planHash}`}>plan JSON</a>
      </div>
    </section>
  );
}
