import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
import { TRANCHE_ROW_OFFSET, type TrancheExitSchema, type TrancheTrigger } from "../../src/domain/user-funded-batches";
import type { z } from "zod";
import { shortAddress } from "../../lib/format";

const sol = (lamports: string | number) => (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 3 });
const utc = (at: number) => new Date(at).toISOString().slice(11, 16) + " UTC";
const usd = (value: number) => "$" + value.toLocaleString("en", { notation: "compact", maximumFractionDigits: 1 });
const account = (wallet: string, text = shortAddress(wallet)) => (
  <a className="mono" href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener noreferrer">{text}</a>
);
const tx = (signature: string, text: string) => (
  <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">{text} ↗</a>
);
const STATUS: Record<string, [string, string]> = {
  waiting: ["Waiting", "wait"], buying: ["Buying", "wait"], holding: ["Holding", "wait"], exiting: ["Selling", "wait"], exited: ["Sold", "ok"],
  settling: ["Paying out", "ok"], settled: ["Paid", "ok"], skipped: ["Skipped", "wait"], review: ["Review", "bad"],
};
type Run = ScheduledLaunchView["batchRuns"][number];
type Wallet = ScheduledLaunchView["wallets"][number];

function RunCard({ title, tag, rule, ruleTitle, trigger, run, wallets }: {
  title: string; tag?: string | null; rule: string; ruleTitle: string; trigger?: string; run: Run | undefined; wallets: Wallet[];
}) {
  const [label, tone] = run ? (STATUS[run.status] ?? [run.status, "wait"]) : ["Scheduled", "wait"];
  const cost = run ? Number(run.buyCostLamports) : 0;
  const result = run?.netSaleLamports && cost > 0 ? (Number(run.netSaleLamports) / cost - 1) * 100 : null;
  return (
    <article className="coin-column">
      <header className="coin-column__head">
        <b>{title}</b>
        {tag ? <span className="mono dim">{tag}</span> : null}
        <span className={`coin-status coin-status--${tone}`}>{label}</span>
      </header>
      {trigger ? <div className="coin-column__rule"><span className="dim">Buys</span> <strong>{trigger}</strong></div> : null}
      <div className="coin-column__rule" title={ruleTitle}>
        <span className="dim">Sells at</span> <strong>{rule}</strong>
      </div>
      <ul className="coin-column__wallets">
        {wallets.map((wallet) => <li>{account(wallet.wallet)}<span>{sol(wallet.budgetLamports)}</span></li>)}
      </ul>
      <footer className="coin-column__foot">
        {result !== null ? <span className={result >= 0 ? "up" : "down"}>{result >= 0 ? "+" : ""}{result.toFixed(1)}%</span> : null}
        {run?.soldWallets && (run.status === "holding" || run.status === "exiting") ? <span>{run.soldWallets} of {wallets.length} sold</span> : null}
        {run?.paidLamports ? <span>paid {sol(run.paidLamports)}</span> : null}
        {run?.buySignature ? tx(run.buySignature, "buy") : null}
        {run?.saleSignature ? tx(run.saleSignature, "sale") : null}
        {run?.payoutSignature ? tx(run.payoutSignature, "payout") : null}
      </footer>
    </article>
  );
}
type Exit = z.infer<typeof TrancheExitSchema>;
const exitRule = (exit: Exit) =>
  exit.kind === "profit" ? `+${exit.profitBps / 100}%` : exit.kind === "time" ? utc(exit.at)
    : exit.kind === "after" ? (exit.seconds ? `${exit.seconds}s after buy` : "Instant")
    : exit.kind === "floor" ? `mcap stays ≥ ${usd(exit.usd)}` : exit.kind === "ladder" ? `1 by 1, mcap ≥ ${usd(exit.usd)}` : "Instant";
const exitTitle = (exit: Exit) =>
  exit.kind === "profit" ? "Sells at this net profit, after costs" : exit.kind === "time" ? "Sells at this time"
    : exit.kind === "after" ? "Sells this many seconds after its buy is final"
    : exit.kind === "floor" ? "Sells all its wallets together once that leaves the market cap at or above this level"
    : exit.kind === "ladder" ? "Sells one wallet at a time, each only if that leaves the market cap at or above this level" : "Sells once its buys confirm";
const triggerText = (trigger: TrancheTrigger) =>
  trigger.kind === "delay" ? `${trigger.seconds}s after launch` : `mcap ${trigger.direction === "above" ? "≥" : "≤"} ${usd(trigger.usd)}`;

/** A user-funded launch's columns (one compact card per bundle transaction),
 * then its tranches (one card per post-launch buy transaction). */
export function UserBatchesPlan({ plan }: { plan: ScheduledLaunchView }) {
  const batches = plan.userBatches!;
  const tranches = batches.tranches ?? [];
  const trancheTotal = tranches.reduce((sum, t) => sum + t.slots.reduce((a, b) => a + b, 0), 0);
  return (
    <section className="panel coin-columns" aria-label="Launch columns">
      <div className="panel__head">
        <span className="label">Columns{tranches.length ? " & tranches" : ""}</span>
        <span className="dim">{sol(Number(plan.totalLamports) + trancheTotal)} SOL · {plan.wallets.length} wallets</span>
      </div>
      <div className="coin-columns__grid">
        {batches.columns.map((column, index) => {
          const wallets = plan.wallets.filter((wallet) => wallet.tranche === undefined && wallet.batchIndex === index);
          return <RunCard title={`Column ${index + 1}`} tag={wallets.find((wallet) => wallet.role === "signer")?.name}
            rule={exitRule(column.exit)} ruleTitle={exitTitle(column.exit)} run={plan.batchRuns.find((row) => row.batchIndex === index)} wallets={wallets} />;
        })}
        {tranches.map((tranche, index) => (
          <RunCard title={`Tranche ${index + 1}`} trigger={triggerText(tranche.trigger)}
            rule={exitRule(tranche.exit)} ruleTitle={exitTitle(tranche.exit)}
            run={plan.batchRuns.find((row) => row.batchIndex === TRANCHE_ROW_OFFSET + index)}
            wallets={plan.wallets.filter((wallet) => wallet.tranche === index)} />
        ))}
      </div>
      <div className="coin-columns__meta">
        <span><span className="dim">Proceeds</span> {account(batches.proceedsWallet)}</span>
        <span><span className="dim">Fees</span> {plan.feesTo ? account(plan.feesTo) : "—"}</span>
        {plan.launchSignature ? tx(plan.launchSignature, "launch") : null}
        <a href={`/api/schedules/${plan.planHash}`}>plan JSON</a>
      </div>
    </section>
  );
}
