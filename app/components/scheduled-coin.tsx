import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
import { ScheduledPlan } from "./scheduled-plan";
import { AdminFinalize } from "./admin-finalize";
import { SiteNav } from "./site-nav";
import { StatusChip } from "./token-cards";
import { adminWallets } from "../../src/server/admin-wallets";
import { launchCountdown } from "../../lib/launch-countdown";
import { seedsShareBps } from "../../src/domain/seeds-split";

const ext = <svg style={{ width: "12px", height: "12px" }}><use href="#i-ext" /></svg>;

/** A coin's page. Before launch: its countdown and plan. Live: its chart, its
 * challenge money, challenges and every submission with asked and paid. The
 * challenge parts are filled by lib/challenges-mount.ts. */
export function ScheduledCoin({ plan, marketCapUsd }: { plan: ScheduledLaunchView; marketCapUsd?: number }) {
  const live = plan.status === "live" && !!plan.mint;
  const dex = plan.mint ? `https://dexscreener.com/solana/${plan.mint}` : "";
  return (
    <div data-scheduled-plan={plan.planHash} data-coin-status={plan.status} data-coin-mint={plan.mint ?? ""}>
      <header className="sky-short">
        <SiteNav />
        <div className="token-head container">
          <a className="back" href="/#launches"><svg className="icon" style={{ width: "14px", height: "14px" }}><use href="#i-back" /></svg>All launches</a>
          <div className="token-id">
            {plan.image ? <img src={plan.image} alt="" /> : null}
            <div className="token-name">
              <div className="row"><h1>${plan.symbol}</h1><StatusChip status={plan.status} /></div>
              <div className="sub">
                <span>{plan.name}</span>
                {plan.mint ? <><span aria-hidden="true">·</span><span className="mono">{plan.mint}</span><button className="btn btn-white btn-xs" type="button" data-copy={plan.mint}>Copy</button></> : null}
              </div>
            </div>
            {live ? (
              <div className="ext-links">
                <a className="btn btn-white" href={dex} target="_blank" rel="noopener noreferrer">DexScreener {ext}</a>
                <a className="btn btn-white" href={`https://solscan.io/token/${plan.mint}`} target="_blank" rel="noopener noreferrer">Solscan {ext}</a>
                <a className="btn btn-primary" href={`https://pump.fun/coin/${plan.mint}`} target="_blank" rel="noopener noreferrer">Trade</a>
              </div>
            ) : null}
          </div>
          {live ? <div className="rolebar"><p data-role-hint>Complete a challenge and submit proof to be paid from this coin’s trading fees.</p></div> : null}
        </div>
      </header>

      {live ? (
        <main className="token-layout container" id="challenges-root" data-mint={plan.mint!}>
          <section className="stats" aria-label="Coin and treasury numbers">
            <div className="stat"><span className="k">Market cap</span><span className="v">{marketCapUsd ? `$${Math.round(marketCapUsd).toLocaleString("en")}` : "Not observed"}</span><span className="s">{marketCapUsd ? "Last seen" : "No trades yet"}</span></div>
            <div className="stat"><span className="k">Fees for challenges</span><span className="v"><span data-stat="earned">0.00</span> SOL</span><span className="s">{100 - seedsShareBps() / 100}% of trading fees</span></div>
            <div className="stat green"><span className="k">Treasury balance</span><span className="v"><span data-stat="available">0.00</span> SOL</span><span className="s">Free for new rewards</span></div>
            <div className="stat lav"><span className="k">Paid to participants</span><span className="v"><span data-stat="paid">0.00</span> SOL</span><span className="s" data-stat="paidsub">0 tasks</span></div>
            <div className="stat"><span className="k">Waiting for review</span><span className="v" data-stat="waiting">0</span><span className="s">Submitted tasks</span></div>
          </section>
          <div className="cols">
            <div className="col-main">
              <section className="card panel" aria-labelledby="chart-h">
                <div className="panel-head"><div><h2 id="chart-h">Price chart</h2><p>Live from DexScreener</p></div></div>
                <div className="chart-frame">
                  <iframe src={`${dex}?embed=1&theme=light&trades=0&info=0`} title={`$${plan.symbol} price chart`} loading="lazy" />
                </div>
                <p className="chart-note">Chart not loading? <a href={dex} target="_blank" rel="noopener noreferrer">Open it on DexScreener</a>.</p>
              </section>
              <section className="card panel" aria-labelledby="tasks-h" data-slot="tasks">
                <div className="panel-head tasks-head"><div><h2 id="tasks-h">Task submissions</h2><p>Every ask and every payout is public.</p></div></div>
                <div className="task-list"><div className="empty">Loading…</div></div>
              </section>
            </div>
            <aside className="col-side">
              <div style={{ display: "contents" }} data-slot="side"></div>
              <section className="card side-card" aria-labelledby="tr-h">
                <h2 id="tr-h">Where the fees go</h2>
                <ol className="flow">
                  <li><span className="n" style={{ background: "var(--lav)", color: "var(--lav-ink)" }}>1</span><div><b>Trading fees</b><small>Every trade pays its creator fee to the treasury</small></div></li>
                  <li><span className="n" style={{ background: "var(--mint)", color: "var(--green-dark)" }}>2</span><div><b>Treasury · <span data-stat="available">0.00</span> SOL free</b><small className="mono" data-treasury-wallet></small></div></li>
                  <li><span className="n" style={{ background: "var(--green)", color: "#fff" }}>3</span><div><b>Rewards</b><small>The creator approves a task and it’s paid on-chain</small></div></li>
                </ol>
              </section>
              <section className="card side-card" aria-labelledby="plan-h">
                <h2 id="plan-h">Launch plan</h2>
                <div id="scheduled-plan-root"><ScheduledPlan plan={plan} /></div>
              </section>
              <AdminFinalize mint={plan.mint!} admins={adminWallets()} />
            </aside>
          </div>
        </main>
      ) : (
        <main className="token-layout container">
          <div className="cols">
            <div className="col-main">
              <section className="card panel coin-countdown" aria-label="Launch time">
                <p className="countdown" role="status" data-launch-at={String(plan.scheduledAt)} data-launch-status={plan.status}>{launchCountdown(plan.scheduledAt, plan.status)}</p>
                {plan.status === "missed" || plan.status === "delayed" ? <p className="hint">{plan.note}</p> : null}
              </section>
              {plan.description ? <section className="card panel"><div className="panel-head"><h2>About</h2></div><p className="about">{plan.description}</p></section> : null}
            </div>
            <aside className="col-side">
              <section className="card side-card" aria-labelledby="plan-h">
                <h2 id="plan-h">Launch plan</h2>
                <div id="scheduled-plan-root"><ScheduledPlan plan={plan} /></div>
              </section>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
