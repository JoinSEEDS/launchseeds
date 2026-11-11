import { getStore } from "../../src/server/runtime";
import { seedsView } from "../../src/server/seeds-view";
import { SiteNav } from "../components/site-nav";
import { sol } from "../components/token-cards";

const ext = <svg style={{ width: "12px", height: "12px" }}><use href="#i-ext" /></svg>;
const tokens = (raw: string) => (Number(raw) / 1e6).toLocaleString("en", { maximumFractionDigits: 0 });

/** LaunchSeeds' own coin: it has no challenges. A share of every coin's fees
 * collects for it in the treasury, and admins spend it buying back and burning $SEEDS. */
export default function SeedsPage() {
  const v = seedsView(getStore()), mint = v.mint, live = v.coin?.status === "live";
  const dex = mint ? `https://dexscreener.com/solana/${mint}` : "";
  return (
    <>
      <header className="sky-short">
        <SiteNav current="seeds" />
        <div className="token-head container">
          <div className="token-id">
            <img src={v.coin?.image || "/logo.png"} alt="" />
            <div className="token-name">
              <div className="row"><h1>$SEEDS</h1>{live ? <span className="chip chip-live"><span className="dot"></span>Live</span> : <span className="chip chip-outline">Launching soon</span>}</div>
              <div className="sub">
                <span>Buyback &amp; burn</span>
                {mint ? <><span aria-hidden="true">·</span><span className="mono">{mint}</span><button className="btn btn-white btn-xs" type="button" data-copy={mint}>Copy</button></> : null}
              </div>
            </div>
            {mint && live ? (
              <div className="ext-links">
                <a className="btn btn-white" href={dex} target="_blank" rel="noopener noreferrer">DexScreener {ext}</a>
                <a className="btn btn-primary" href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noopener noreferrer">Trade</a>
              </div>
            ) : null}
          </div>
          <div className="rolebar"><p>{v.pool.bps / 100}% of every coin’s trading fees buys back and burns $SEEDS.</p></div>
        </div>
      </header>
      <main className="token-layout container" id="seeds-root" data-mint={mint ?? ""}>
        <section className="stats" aria-label="$SEEDS numbers">
          <div className="stat"><span className="k">Market cap</span><span className="v">{v.coin?.marketCapUsd ? `$${Math.round(v.coin.marketCapUsd).toLocaleString("en")}` : "Not observed"}</span><span className="s">Last seen</span></div>
          <div className="stat"><span className="k">Earned</span><span className="v"><span data-seeds="accrued">{sol(v.pool.accrued)}</span> SOL</span><span className="s">{v.pool.bps / 100}% of coins’ fees</span></div>
          <div className="stat green"><span className="k">Ready to burn</span><span className="v"><span data-seeds="spendable">{sol(v.pool.spendable)}</span> SOL</span><span className="s">In the treasury</span></div>
          <div className="stat lav"><span className="k">Spent on buybacks</span><span className="v"><span data-seeds="spent">{sol(v.pool.spent)}</span> SOL</span><span className="s">All time</span></div>
          <div className="stat"><span className="k">Burned</span><span className="v" data-seeds="burned">{tokens(v.pool.burnedRaw)}</span><span className="s">$SEEDS</span></div>
        </section>
        <div className="cols">
          <div className="col-main">
            {mint && live ? (
              <section className="card panel" aria-labelledby="chart-h">
                <div className="panel-head"><div><h2 id="chart-h">Price chart</h2><p>Live from DexScreener</p></div></div>
                <div className="chart-frame"><iframe src={`${dex}?embed=1&theme=light&trades=0&info=0`} title="$SEEDS price chart" loading="lazy" /></div>
              </section>
            ) : null}
            <section className="card panel" aria-labelledby="burns-h">
              <div className="panel-head"><div><h2 id="burns-h">Buybacks &amp; burns</h2><p>Every buy and burn is on-chain.</p></div></div>
              <div className="task-list" data-seeds="burns"><div className="empty">No burns yet.</div></div>
            </section>
          </div>
          <aside className="col-side">
            <div style={{ display: "contents" }} data-seeds="admin"></div>
            <section className="card side-card" aria-labelledby="flow-h">
              <h2 id="flow-h">Where it comes from</h2>
              <ol className="flow">
                <li><span className="n" style={{ background: "var(--lav)", color: "var(--lav-ink)" }}>1</span><div><b>Every coin’s fees</b><small>{v.pool.bps / 100}% goes to $SEEDS, the rest to the coin’s challenges</small></div></li>
                <li><span className="n" style={{ background: "var(--mint)", color: "var(--green-dark)" }}>2</span><div><b>Treasury</b><small className="mono" data-treasury-wallet></small></div></li>
                <li><span className="n" style={{ background: "var(--green)", color: "#fff" }}>3</span><div><b>Buy back &amp; burn</b><small>Bought $SEEDS is burned for good</small></div></li>
              </ol>
            </section>
            <section className="card side-card" aria-labelledby="from-h">
              <h2 id="from-h">Top contributors</h2>
              {v.contributions.length ? (
                <dl className="facts small" style={{ gridTemplateColumns: "1fr" }}>
                  {v.contributions.slice(0, 10).map((c) => <div><dt>{c.mint ? <a href={`/coin/${c.mint}`}>${c.symbol}</a> : `$${c.symbol}`}</dt><dd>{sol(c.seedsLamports)} SOL</dd></div>)}
                </dl>
              ) : <p className="hint">No fees yet.</p>}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
