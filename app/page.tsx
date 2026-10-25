import { getStore } from "../src/server/runtime";
import { getCatalog } from "../src/server/catalog";
import { strategyBoard } from "../lib/governance";
import { strategyName } from "../lib/strategy";
import { quoteStrategy } from "../lib/treasury-readiness";
import { initials } from "../lib/format";
import {
  getTokenMarketCap,
  getMintMarketCap,
} from "../src/server/token-market";
import { mapLimited } from "../lib/async-batch";
import { unclaimedFeesSoon } from "../src/server/creator-fees";

export default async function HomePage() {
  const store = getStore();
  const tokens = store.listLive();
  const [catalog, tokenCap] = await Promise.all([
    getCatalog().catch(() => null),
    getTokenMarketCap().catch(() => null),
  ]);
  const items = tokens.map((token) => {
    const board = strategyBoard(token.id),
      active = board?.active;
    const quote = active ? quoteStrategy(active, catalog, Date.now()) : null;
    const cost = quote?.costMicros ?? null;
    const available = Math.max(
      0,
      token.collectedMicros - token.spentMicros - token.reservedMicros,
    );
    const progress =
      cost && cost > 0 ? Math.min(100, (100 * available) / cost) : 0;
    return {
      token,
      board,
      active,
      cost,
      available,
      progress,
      holders: store.leaderboard(token.id).holders.length,
    };
  });
  // Bound concurrent RPC reads; only real pool-derived prices and actual mint
  // supply can produce a market cap. Never fill the table with sample prices.
  const capPairs = await mapLimited(items, 4, async ({ token }) => {
    const [cap, fees] = await Promise.all([
      getMintMarketCap(token.mint, token.priceUsd),
      unclaimedFeesSoon(token),
    ]);
    return { id: token.id, cap, fees };
  });
  const marketCaps = new Map(capPairs.map((row) => [row.id, row.cap]));
  // Recorded treasury credit plus creator fees still unclaimed in on-chain vaults.
  const sum =
    items.reduce((n, row) => n + row.available, 0) +
    capPairs.reduce((n, row) => n + (row.fees ?? 0), 0);
  const best = items
    .filter((row) => row.cost !== null)
    .sort((a, b) => b.progress - a.progress)[0];
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Tokens governed by their holders</h1>
          <p className="page-lede">
            Explore holder-governed tokens and their treasuries. Holders can
            vote on strategies including cards, tokenized stocks, buybacks and
            wallet rewards.
          </p>
        </div>
      </div>
      <div className="grid-3">
        <section className="panel">
          <div className="panel__head">
            <span className="label">Paid to holders (24h)</span>
          </div>
          <div className="kv">
            <div>
              <div className="label label--sm">Paid out</div>
              <div className="kv__value">$0.00</div>
            </div>
            <div className="kv__item--end">
              <div className="label label--sm">Rewards</div>
              <div className="kv__value">0</div>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel__head">
            <span className="label">Waiting to pay out</span>
          </div>
          <div className="kv">
            <div>
              <div className="label label--sm">Fees accumulated</div>
              <div className="kv__value" data-num="">${(sum / 1e6).toFixed(2)}</div>
            </div>
            <div className="kv__item--end">
              <div className="label label--sm">Live treasuries</div>
              <div className="kv__value">{items.length}</div>
            </div>
          </div>
          <a
            className="panel__foot"
            href={
              best ? `/token/${encodeURIComponent(best.token.mint ?? "")}` : "/launch"
            }
          >
            <span>
              {best
                ? `$${best.token.symbol} · ${strategyName(best.active!, catalog || undefined)}`
                : "Launch a token"}
            </span>
            <b>{best ? `${Math.round(best.progress)}%` : "Launch Token"}</b>
          </a>
        </section>
        <section className="panel">
          <div className="panel__head">
            <a className="label" href="/token">
              $TOKEN
            </a>
          </div>
          <div className="kv">
            <div>
              <div className="label label--sm">Market cap</div>
              <div className="kv__value">
                {tokenCap === null ? "Not available" : tokenCap}
              </div>
            </div>
            <div className="kv__item--end">
              <div className="label label--sm">Burned</div>
              <div className="kv__value">0</div>
            </div>
          </div>
          <a className="panel__foot" href="/token">
            <span>Buyback & burn</span>
            <b>View</b>
          </a>
        </section>
      </div>
      <div className="split">
        <aside className="split__side">
          <section className="panel panel__body--roomy">
            <h2 className="how-title">How it works</h2>
            <ol className="how">
              <li>Launch a token and choose what its fees do first.</li>
              <li>Trading fees fill the token's treasury.</li>
              <li>
                Holders vote any time. The leading strategy becomes active after
                3 minutes.
              </li>
            </ol>
            <a className="btn btn--primary btn--block" href="/launch">
              Launch Token
            </a>
          </section>
        </aside>
        <section className="split__main" aria-labelledby="tokens-title">
          <h2 className="section-title" id="tokens-title">
            Tokens
          </h2>
          <div className="ledger-bar">
            <div className="tabs" role="tablist" aria-label="Token filters">
              <button
                className="tab"
                role="tab"
                aria-selected="true"
                type="button"
              >
                Next reward
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected="false"
                type="button"
              >
                Recently switched
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected="false"
                type="button"
              >
                New
              </button>
            </div>
            <label className="search">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8b94a3"
                strokeWidth={2.4}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7"></circle>
                <path d="M20 20l-3.5-3.5"></path>
              </svg>
              <span className="sr-only">Search tokens</span>
              <input
                type="search"
                placeholder="Search ticker or CA"
                data-filter="#token-table"
              />
            </label>
          </div>
          <div className="table-wrap">
            <table className="table" id="token-table">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Active strategy</th>
                  <th scope="col">
                    {items.length ? "Next reward ↓" : "Next reward"}
                  </th>
                  <th scope="col" className="num">
                    Mcap
                  </th>
                  <th scope="col" className="num">
                    Holders
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map(
                    ({
                      token,
                      board,
                      active,
                      cost,
                      available,
                      progress,
                      holders,
                    }) => (
                      <tr
                        className="is-link"
                        data-href={`/token/${encodeURIComponent(token.mint ?? "")}`}
                        data-progress={String(progress)}
                        data-created={String(token.createdAt)}
                        data-switched={String(board?.switchedAt || 0)}
                        data-search={`${token.name} ${token.symbol} ${token.mint}`.toLowerCase()}
                      >
                        <td>
                          <a
                            className="token"
                            href={`/token/${encodeURIComponent(token.mint ?? "")}`}
                          >
                            <span
                              className="av"
                              style={{ background: "#2e3b78" }}
                            >
                              {token.image ? (
                                <img
                                  className="avatar-image"
                                  src={token.image}
                                  alt=""
                                />
                              ) : (
                                initials(token.name)
                              )}
                            </span>
                            <span>
                              <span className="token__name">
                                ${token.symbol}
                              </span>
                              <span className="token__sub">{token.name}</span>
                            </span>
                          </a>
                        </td>
                        <td>
                          <span className="strategy-inline">
                            {active
                              ? strategyName(active, catalog || undefined)
                              : "—"}
                          </span>
                        </td>
                        <td>
                          <span className="meter">
                            <span className="bar">
                              <i style={{ width: `${progress}%` }} />
                            </span>
                            <b>
                              {cost === null ? "—" : `${Math.round(progress)}%`}
                            </b>
                          </span>
                          <span
                            className="dim"
                            style={{
                              display: "block",
                              fontSize: "11px",
                              marginTop: "3px",
                            }}
                          >
                            {cost === null
                              ? "Live quote unavailable"
                              : `$${(available / 1e6).toFixed(2)} of $${(cost / 1e6).toFixed(2)}`}
                          </span>
                        </td>
                        <td className="num">
                          {marketCaps.get(token.id) ?? "—"}
                        </td>
                        <td className="num">{holders.toLocaleString()}</td>
                      </tr>
                    ),
                  )
                ) : (
                  <tr>
                    <td colSpan={5} className="empty-table">
                      <div className="empty-state">
                        <span>No live tokens yet.</span>
                        <a className="btn btn--primary" href="/launch">
                          Launch Token
                        </a>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
