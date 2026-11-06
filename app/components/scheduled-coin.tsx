import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
import { ScheduledPlan } from "./scheduled-plan";
import { AdminFinalize } from "./admin-finalize";
import { CoinActivity } from "./coin-activity";
import { adminWallets } from "../../src/server/admin-wallets";
import { launchCountdown } from "../../lib/launch-countdown";
import { shortAddress } from "../../lib/format";

const STATUS: Record<string, string> = {
  awaiting_payment: "Awaiting payment", scheduled: "Scheduled", delayed: "Launching", launching: "Launching",
  live: "Live", missed: "Missed", review: "Review",
};

/** A scheduled coin's page, before and after launch: what matters at a glance,
 * no walls of text. The full plan stays one click away (plan JSON). */
export function ScheduledCoin({ plan }: { plan: ScheduledLaunchView }) {
  const live = plan.status === "live" && !!plan.mint;
  // The launch's own wallets, named in the trades and gravity tables.
  const labels = Object.fromEntries(plan.wallets.map((w) => [w.wallet, w.tranche !== undefined ? `T${w.tranche + 1} fresh` : `C${(w.batchIndex ?? 0) + 1} ${w.role === "signer" ? w.name ?? "signer" : "fresh"}`]));
  return (
    <main className="page coin" data-scheduled-plan={plan.planHash} data-coin-status={plan.status} data-coin-mint={plan.mint ?? ""} data-coin-labels={JSON.stringify(labels)}>
      <header className="coin-head">
        {plan.image ? <img className="coin-head__img" src={plan.image} alt="" width={56} height={56} /> : <div className="coin-head__img coin-head__img--blank" aria-hidden="true">{plan.symbol.slice(0, 2)}</div>}
        <div className="coin-head__title">
          <h1 className="page-title">${plan.symbol} <span className="dim">{plan.name}</span></h1>
          <div className="coin-head__meta">
            <span className={`coin-status coin-status--${live ? "ok" : plan.status === "missed" || plan.status === "review" ? "bad" : "wait"}`}>{STATUS[plan.status] ?? plan.status}</span>
            {plan.mint ? <button className="btn-copy mono" type="button" data-copy={plan.mint} title={plan.mint}>{shortAddress(plan.mint)} ⧉</button> : null}
          </div>
        </div>
        {live ? <a className="btn btn--primary" href={`https://pump.fun/coin/${plan.mint}`} target="_blank" rel="noopener noreferrer">Trade on Pump</a> : null}
      </header>

      {live ? (
        <>
          <section className="panel chart-panel" aria-label="Price chart">
            <iframe className="chart-frame" src={`https://dexscreener.com/solana/${plan.mint}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1`} title={`$${plan.symbol} price chart`} loading="lazy" allow="clipboard-write" />
          </section>
          <div id="coin-activity-root"><CoinActivity activity={null} labels={labels} /></div>
        </>
      ) : (
        <section className="panel coin-countdown" aria-label="Launch time">
          <p className="coin-countdown__value" role="status" data-launch-at={String(plan.scheduledAt)} data-launch-status={plan.status}>{launchCountdown(plan.scheduledAt, plan.status)}</p>
          <time className="dim" dateTime={new Date(plan.scheduledAt).toISOString()}>{new Date(plan.scheduledAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
          {plan.status === "missed" || plan.status === "delayed" ? <p className="setting-help">{plan.note}</p> : null}
        </section>
      )}

      <div id="scheduled-plan-root"><ScheduledPlan plan={plan} /></div>

      {plan.description ? (
        <details className="panel coin-about">
          <summary className="panel__head"><span className="label">About</span></summary>
          <p className="panel__body">{plan.description}</p>
        </details>
      ) : null}
      {live ? <AdminFinalize mint={plan.mint!} admins={adminWallets()} /> : null}
    </main>
  );
}
