import { displayStrategyCostMicros } from "../../../lib/reward-funding";
import { xLink } from "../../../lib/launch-socials";
import { storedLaunchSettings, durationText, activeLockUntil, elapsedText } from "../../../src/domain/launch-settings";
import { getStore } from "../../../src/server/runtime";
import { strategyBoard } from "../../../lib/governance";
import { storedHomeObservations } from "../../../src/server/home-snapshot";
import { strategyName } from "../../../lib/strategy";
import {
  quoteStrategy,
  calculateReadiness,
} from "../../../lib/treasury-readiness";
import { initials, shortAddress } from "../../../lib/format";
import { tokenWins, raffleLeaderboard } from "../../../src/server/draws";
import { marketView } from "../../../src/server/market-view";
import { bundleView } from "../../../src/server/bundle-view";

function boardLockUntil(tokenId: number, store: ReturnType<typeof getStore>, settings: ReturnType<typeof storedLaunchSettings>, now: number) {
  const token = store.repo.tokens.get(tokenId);
  const state = store.repo.operations.state(tokenId);
  if (!token || !state) return 0;
  return activeLockUntil(token, {
    initialStrategyId: state.initialStrategyId,
    launchedAt: token.launchedAt ?? now,
    activatedAt: token.activeStrategyId === state.initialStrategyId ? token.launchedAt ?? now : state.switchedAt,
    firstLockMs: settings.firstStrategyLockMs,
    minimumActiveMs: settings.minimumActiveMs,
  });
}

export default function TokenPage({
  params,
}: {
  params: { id: string };
}) {
  // The URL carries the token's CA; the internal id never leaves the server.
  const store = getStore();
  let tokenId: number;
  let token: ReturnType<typeof store.token>;
  try {
    tokenId = store.liveTokenId(params.id);
    token = store.token(tokenId);
  } catch {
    return (
      <main className="page">
        <h1 className="page-title">Token not found</h1>
        <a href="/">Launchpad</a>
      </main>
    );
  }
  const settings = storedLaunchSettings(token.launchSettingsJson);
  const lockUntil = boardLockUntil(tokenId, store, settings, Date.now());
  const strategyState = store.repo.operations.state(tokenId);
  const creatorLocked = token.activeStrategyId === strategyState?.initialStrategyId &&
    Date.now() < (token.launchedAt ?? 0) + settings.firstStrategyLockMs;
  // When the current active strategy took over (the first one: at launch).
  const activeSince = token.activeStrategyId === strategyState?.initialStrategyId
    ? token.launchedAt ?? Date.now()
    : strategyState?.switchedAt ?? token.launchedAt ?? Date.now();
  const lockLeft = lockUntil - Date.now();
  const lockText = lockLeft <= 0
    ? "open to takeover"
    : `${creatorLocked ? "locked for" : "can change in"} ${lockLeft >= 3_600_000 ? `${Math.ceil(lockLeft / 3_600_000)}h` : `${Math.ceil(lockLeft / 60_000)}m`}`;
  const observations = storedHomeObservations(store);
  const board = strategyBoard(tokenId), catalog = observations.catalog;
  const active = board?.active;
  const ready = active
    ? calculateReadiness(
        active,
        quoteStrategy(active, catalog, Date.now()),
        {
          tokenId: tokenId,
          status: "live",
          treasuryAddress: token.rewardWallet,
          collectedMicros: token.collectedMicros,
          spentMicros: token.spentMicros,
          reservedMicros: token.reservedMicros,
          holderSnapshotAt: token.holdersUpdatedAt,
          holderSnapshotSlot: token.snapshotSlot,
          balance: null,
        },
        Date.now(),
      )
    : null;
  const available = Math.max(0, (ready?.recordedAvailableMicros ?? 0) / 1e6);
  const displayCost = active ? displayStrategyCostMicros(active, catalog, active.type === "pack" ? store.repo.packs.get(active.ref)?.priceUsdCents : undefined) : null;
  const cost = displayCost === null ? null : displayCost / 1e6;
  const pct = cost ? Math.min(100, 100 * available / cost) : 0;
  const observation = observations.capPairs.find(row => row.id === tokenId);
  const marketCap = observation?.cap ?? null, unclaimedFees = observation?.fees ?? null;
  const leaderboard = raffleLeaderboard(store, token.id);
  // Holders other than LaunchSeeds's own wallets (treasury, sniper-protection bundle).
  const holderCount = leaderboard.holders.length;
  const wins = tokenWins(store, token.id);
  const market = marketView(store, token.id);
  const bundle = bundleView(store, token.id);
  // Holder-reward coins: fees go to holders through Pump, so the treasury,
  // strategy vote and pack rewards do not apply; the sniper-protection fund does.
  const sniperCoin = market.holderRewards;
  const bundleStatus: Record<string, string> = {
    buying: "Launching", holding: "Holding", exiting: "Selling", exited: "Sold, sweeping to the fund",
    closed: "Sold; profit held in the fund", settling: "Paying out profit", settled: "Settled", abandoned: "Not launched",
  };
  const sol = (lamports: string | bigint) => `${(Number(lamports) / 1e9).toFixed(4)} SOL`;
  const units = (raw: string) => (Number(raw) / 10 ** market.tokenDecimals).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const pendingWin = wins.find((w) => !w.card) ?? null;
  const nextPack = (wins[0]?.number ?? 0) + 1;
  // Public votes may be capped by the governance journal. An absent vote here
  // means unobserved, not necessarily that the holder never voted.
  const visibleVotes = new Map(
    (board?.votes || []).map((vote) => [vote.wallet, vote.config]),
  );
  const title = active
    ? strategyName(active, catalog || undefined)
    : "Not configured";
  return (
    <>
      <main className="page" id="governed-token" data-token-mint={token.mint ?? ""} data-holder-rewards={market.holderRewards ? "true" : "false"}>
        <div className="page-head">
          <span className="av av--lg" style={{ background: "#2e3b78" }}>
            {token.image ? (
              <img className="avatar-image" src={token.image} alt="" />
            ) : (
              initials(token.name)
            )}
          </span>
          <div>
            <div className="title-row">
              <h1 className="page-title">${token.symbol}</h1>
              <span className="addr">
                <span className="mono">{shortAddress(token.mint)}</span>
                <button
                  className="btn-copy"
                  data-copy={token.mint}
                  type="button"
                  aria-label="Copy contract address"
                >
                  Copy
                </button>
              </span>
            </div>
            <p className="page-lede">
              {!sniperCoin
                ? "Holders vote on what this token's fees do. Each reward is funded by its treasury."
                : settings.feesTo
                  ? `Launched with sniper protection. Creator fees go to ${shortAddress(settings.feesTo)}.`
                  : bundle
                    ? "Launched with sniper protection. Pump pays its trading fees to holders in SOL."
                    : "Pump pays this coin's trading fees to holders in SOL."}
            </p>
            <div className="social-row">
              {token.website ? (
                <a
                  href={token.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Website
                </a>
              ) : null}
              {token.x ? (
                <a
                  href={xLink(token.x)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  X
                </a>
              ) : null}
              {token.telegram ? (
                <a
                  href={`https://t.me/${token.telegram.replace(/^(https:\/\/t\.me\/|t\.me\/|@)/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Telegram
                </a>
              ) : null}
            </div>
          </div>
          <div className="page-head__stats">
            <div>
              <div className="label label--sm">Market cap</div>
              <div className="kv__value" data-num="">{marketCap ?? "—"}</div>
            </div>
            <div>
              <div className="label label--sm">Active holders</div>
              <div className="kv__value" data-num="">
                {holderCount.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
        <section className="panel" hidden={sniperCoin}>
          <div className="panel__head">
            <span className="label">Treasury</span>
            <span className="addr">
              {token.rewardWallet ? (
                <>
                  <span className="mono">
                    {shortAddress(token.rewardWallet)}
                  </span>
                  <button
                    className="btn-copy"
                    type="button"
                    data-copy={token.rewardWallet}
                  >
                    Copy
                  </button>
                </>
              ) : (
                <span className="mono">Not configured</span>
              )}
            </span>
          </div>
          <div className="treasury">
            <div>
              <p className="treasury-next" id="treasury-next">
                {pendingWin
                  ? <>Pack #{pendingWin.number} winner drawn: <span className="mono">{shortAddress(pendingWin.winner)}</span>. Fees first buy their {pendingWin.packName} (${pendingWin.priceUsd.toFixed(2)}), then collect for pack #{nextPack}.</>
                  : wins.length
                    ? <>Collecting fees for pack #{nextPack}.</>
                    : null}
              </p>
              <div className="label label--sm">Waiting to pay out</div>
              <div className="treasury__amount">
                <b id="treasury-available" data-num="">${available.toFixed(2)}</b>
                <span id="treasury-needed">
                  {cost === null ? "Awaiting price" : `of $${cost.toFixed(2)}`}
                </span>
              </div>
              <div className="treasury__fees" id="treasury-fees-row" hidden={unclaimedFees === null}>
                <span className="label label--sm">Fees accumulated</span>
                <b id="treasury-fees" data-num="">
                  ${((unclaimedFees ?? 0) / 1e6).toFixed(2)}
                </b>
              </div>
            </div>
            <div className="treasury__rule" aria-hidden="true" />
            <div className="treasury__active">
              <span>
                <span className="label label--sm">
                  Active strategy
                </span>
                <b id="active-strategy">{title}</b>
                <small className="dim">
                  <span id="active-since" data-active-since={activeSince}>Active {elapsedText(Date.now() - activeSince)}</span>
                  {" · "}
                  <span id="active-lock-text" data-lock-until={lockUntil} data-creator-locked={creatorLocked ? "true" : "false"}>{lockText}</span>
                </small>
              </span>
            </div>
          </div>
          <div className="wide-bar">
            <div
              className="bar"
              id="treasury-progress"
              role="progressbar"
              aria-label="Progress to next reward"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.floor(pct)}
            >
              <i style={{ width: `${pct}%` }} />
            </div>
            <small>
              <span id="next-reward-deficit" data-num="">
                {cost === null
                  ? "Fresh price unavailable"
                  : `$${Math.max(0, cost - available).toFixed(2)} to go`}
              </span>
            </small>
            <p
              className="treasury-verification"
              id="treasury-verification"
              hidden
            ></p>
          </div>
        </section>
        {token.mint && token.status === "live" ? (
          <section className="panel chart-panel" aria-labelledby="chart-title">
            <div className="panel__head">
              <span className="label" id="chart-title">Chart</span>
              <a className="status" href={`https://dexscreener.com/solana/${token.mint}`} target="_blank" rel="noopener noreferrer">DexScreener</a>
            </div>
            <iframe
              className="chart-frame"
              src={`https://dexscreener.com/solana/${token.mint}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1`}
              title={`$${token.symbol} price chart`}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups"
            ></iframe>
          </section>
        ) : null}
        <div className="split">
          <aside className="split__side">
            {token.mint && token.status === "live" ? (
              <section className="panel trade" id="trade-panel" data-symbol={token.symbol} aria-labelledby="trade-title">
                <div className="panel__head">
                  <span className="label" id="trade-title">Trade</span>
                  <a className="status" href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noopener noreferrer">pump.fun</a>
                </div>
                <div className="panel__body stack stack--tight">
                  <div className="trade__tabs" role="tablist" aria-label="Buy or sell">
                    <button className="trade__tab is-buy" type="button" role="tab" data-side="buy" aria-selected="true">Buy</button>
                    <button className="trade__tab is-sell" type="button" role="tab" data-side="sell" aria-selected="false">Sell</button>
                  </div>
                  <div data-for="buy" className="stack stack--tight">
                    <span className="amount__input">
                      <input id="trade-sol" inputMode="decimal" placeholder="0.1" aria-label="SOL to spend" autoComplete="off" />
                      <span>SOL</span>
                    </span>
                    <div className="chips">
                      {["0.1", "0.5", "1", "2"].map((v) => <button className="chip" type="button" data-buy-sol={v} aria-label={`${v} SOL`}>{v}</button>)}
                    </div>
                  </div>
                  <div data-for="sell" className="stack stack--tight" hidden>
                    <div className="chips">
                      {[25, 50, 75, 100].map((v) => <button className="chip" type="button" data-sell-pct={String(v)} aria-pressed={String(v === 100)}>{`${v}%`}</button>)}
                    </div>
                    <p className="setting-help">Of this coin in your wallet.</p>
                  </div>
                  <div className="trade__slippage">
                    <span className="label label--sm">Slippage</span>
                    <div className="chips">
                      {[1, 2, 5, 10, 20].map((v) => <button className="chip chip--sm" type="button" data-slippage={String(v)} aria-pressed={String(v === 5)}>{`${v}%`}</button>)}
                    </div>
                  </div>
                  <button className="btn btn--primary btn--block" type="button" id="trade-go">Connect Wallet</button>
                  <p className="opt-note" id="trade-message" role="status" aria-live="polite" hidden></p>
                  <p className="setting-help">Trades on Pump's bonding curve from your own wallet. LaunchSeeds never holds your funds.</p>
                </div>
              </section>
            ) : null}
            <section
              className="panel panel__body--roomy position"
              data-position=""
              aria-live="polite"
              id="position-panel"
            >
              <div className="label">Your position</div>
              <div data-when="disconnected" id="holder-disconnected">
                <h2 className="position-title">{sniperCoin ? "Connect your wallet" : "Connect to vote"}</h2>
                <p className="position-text">
                  {sniperCoin
                    ? "See your balance and Gravity: your share of any profit this coin's fund pays to holders. Connecting sends nothing."
                    : "Your vote weighs as much as your gravity. Signing is free; nothing is sent."}
                </p>
                <button
                  className="btn btn--block"
                  type="button"
                  data-connect=""
                  id="connect-holder"
                >
                  Connect Wallet
                </button>
              </div>
              <div data-when="connected" hidden id="holder-info"></div>
              <p id="holder-error" role="status" className="opt-note"></p>
            </section>

          </aside>
          <div className="split__main split__main--stack">
            <section
              hidden={sniperCoin}
              className="stack stack--tight"
              aria-labelledby="vote-title"
            >
              <h2 className="section-title" id="vote-title">Strategy Vote</h2>
              <div className="ledger-bar">
                <span className="status">
                  <span>
                    <b
                      style={{ color: "var(--text-hi)" }}
                      data-voters=""
                      data-num=""
                      id="voter-count"
                    >
                      0
                    </b>{" "}
                    voters,{" "}
                    <b
                      style={{ color: "var(--text-hi)" }}
                      data-turnout=""
                      data-num=""
                      id="strategy-turnout"
                    >
                      0%
                    </b>{" "}
                    of gravity
                  </span>
                </span>
                <span className="status">Leader takes over after 3:00 on top. Each strategy runs at least {durationText(settings.minimumActiveMs)}.</span>
              </div>
              <div className="table-wrap">
                <div className="table-top">
                  <div className="table-top__row">
                    <span className="label label--sm">
                      Share of all gravity
                    </span>
                  </div>
                  <div
                    className="turnout"
                    data-turnout-bar=""
                    aria-hidden="true"
                  ></div>
                </div>
                <div
                  data-dist=""
                  aria-live="polite"
                  id="strategy-distribution"
                ></div>
                <div className="ballot-foot">
                  <p data-ballot-msg="" id="vote-message">
                    Don't see it here? Vote for any pack, stock, burn or payout.
                    You can change your vote any time.
                  </p>
                  <button
                    className="btn btn--primary"
                    type="button"
                    data-open-vote=""
                    id="open-vote"
                  >
                    Vote for Something New
                  </button>
                </div>
              </div>
            </section>

            {bundle ? (
              <section
                className="stack stack--tight"
                aria-labelledby="sniper-title"
                id="sniper-bundle"
                data-mint={token.mint ?? ""}
                data-owner={process.env.LAUNCHSEEDS_FUND_OWNER_WALLET?.trim() ?? ""}
                data-launcher={bundle.external ? "" : bundle.launcherWallet ?? ""}
                data-status={bundle.status}
              >
                <div className="ledger-bar">
                  <h2 className="section-title section-title--sm" id="sniper-title">Sniper protection</h2>
                  <span className="status">{bundleStatus[bundle.status] ?? bundle.status}</span>
                </div>
                <p className="setting-help">
                  This coin was created and first bought in one Jito bundle, so no sniper could buy before it.
                  LaunchSeeds's fund bought {sol(bundle.totalLamports)} from three public wallets. They sell together
                  once each gets back {bundle.exitTargetPercent}% of its buy{bundle.external
                    ? <>. The profit of that sale buys this coin back slowly, and everything bought back is burned.</>
                    : <>{bundle.holdUntil ? <>, or at market at {new Date(bundle.holdUntil).toUTCString().slice(5, 22)} UTC if that hasn't happened</> : null}.
                      They also sell at market if the fund needs the capital for a new launch, or if the launcher
                      closes it. Profit stays in the fund until the coin is liquidated, then goes to the fund owner
                      or to this coin's holders by Gravity.</>}
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Wallet</th>
                        <th scope="col" className="num">Bought</th>
                        <th scope="col" className="num">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.wallets.map((w) => (
                        <tr>
                          <td><a className="mono" href={`https://solscan.io/account/${w.wallet}`} target="_blank" rel="noopener noreferrer">{shortAddress(w.wallet)}</a></td>
                          <td className="num">{sol(w.boughtLamports)}</td>
                          <td className="num">{w.tokensRaw ? units(w.tokensRaw) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="dl">
                  <dt>Sell target</dt>
                  <dd>{bundle.exitTargetPercent}% of each buy</dd>
                  {bundle.holdUntil ? (
                    <>
                      <dt>Time limit</dt>
                      <dd>{new Date(bundle.holdUntil).toUTCString().slice(5, 22)} UTC</dd>
                    </>
                  ) : null}
                  {bundle.exitSignature ? (
                    <>
                      <dt>{{ profit: "Sold at target", rotation: "Sold at market (capital needed)", deadline: "Sold at market (time limit)", close: "Sold at market (closed by the launcher)" }[bundle.exitKind ?? "rotation"]}</dt>
                      <dd><a href={`https://solscan.io/tx/${bundle.exitSignature}`} target="_blank" rel="noopener noreferrer">Tx</a></dd>
                    </>
                  ) : null}
                  {bundle.proceedsLamports ? (
                    <>
                      <dt>Returned to the fund</dt>
                      <dd data-num="">{sol(bundle.proceedsLamports)} (cost {sol(bundle.costLamports)})</dd>
                      <dt>Profit</dt>
                      <dd data-num="">{bundle.profitLamports ? sol(bundle.profitLamports) : "—"}</dd>
                    </>
                  ) : null}
                  {bundle.settlement ? (
                    <>
                      <dt>Profit goes to</dt>
                      <dd>{bundle.settlement === "owner" ? "The fund owner" : "Holders, by Gravity"}</dd>
                    </>
                  ) : null}
                  {bundle.buyback ? (
                    <>
                      <dt>Profit buyback</dt>
                      <dd>
                        {bundle.buyback.skipped
                          ? bundle.buyback.skipped
                          : <>
                              {bundle.buyback.done} of {bundle.buyback.steps} buys · {sol(bundle.buyback.profitLamports)} of profit, from{" "}
                              <a className="mono" href={`https://solscan.io/account/${bundle.buyback.wallet}`} target="_blank" rel="noopener noreferrer">{shortAddress(bundle.buyback.wallet)}</a>
                              <br />
                              {bundle.buyback.burn?.signature
                                ? <>Burned {units(bundle.buyback.burn.tokensRaw)} tokens · <a href={`https://solscan.io/tx/${bundle.buyback.burn.signature}`} target="_blank" rel="noopener noreferrer">Tx</a></>
                                : "Everything bought back is burned after the last buy."}
                            </>}
                      </dd>
                    </>
                  ) : null}
                  {bundle.payouts.length ? (
                    <>
                      <dt>Payouts</dt>
                      <dd>
                        {bundle.payouts.map((p) => (
                          <span className="payout">
                            {p.recipients} wallet{p.recipients === 1 ? "" : "s"} · {sol(p.totalLamports)}{" "}
                            {p.signature ? <a href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noopener noreferrer">Tx</a> : p.status}
                            <br />
                          </span>
                        ))}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div id="close-row" hidden>
                  <div className="label label--sm">You launched this coin</div>
                  <div className="btn-row">
                    <button className="btn btn--sm" type="button" id="close-bundle">Close sniper protection</button>
                  </div>
                  <p className="setting-help">Sells the three bundle wallets at market now. The proceeds return to LaunchSeeds's fund; you pay nothing.</p>
                  <p className="opt-note" id="close-message" role="status" hidden></p>
                </div>
                <div id="liquidate-row" hidden data-settled={bundle.settlement || bundle.external ? "true" : "false"}>
                  <div className="label label--sm">Fund owner: liquidate and send this coin's profit to</div>
                  <div className="btn-row">
                    <button className="btn btn--sm" type="button" data-liquidate="holders">Holders, by Gravity</button>
                    <button className="btn btn--sm btn--ghost" type="button" data-liquidate="owner">The owner wallet</button>
                  </div>
                  <p className="opt-note" id="liquidate-message" role="status" hidden></p>
                </div>
              </section>
            ) : null}

            <section className="stack stack--tight" aria-labelledby="rewards-title" hidden={sniperCoin}>
              <div className="ledger-bar">
                <h2 className="section-title section-title--sm" id="rewards-title">Rewards</h2>
                <span className="status" id="votes-updated">Votes refresh automatically</span>
              </div>
              <p className="opt-note" id="claim-message" role="status" aria-live="polite" hidden></p>
              <div className="table-wrap" id="ledger-rewards">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Strategy</th>
                      <th scope="col" className="num">Spent</th>
                      <th scope="col">Result</th>
                      <th scope="col">Recipient</th>
                      <th scope="col" className="num">When</th>
                      <th scope="col" className="num"><span className="sr-only">Transaction</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {wins.length ? (
                      wins.map((w) => (
                        <tr className={w.card || w.stock?.status === "sent" ? "" : "is-pending"}>
                          <td>{w.number}</td>
                          <td>{w.packName}</td>
                          <td className="num">${w.priceUsd.toFixed(2)}</td>
                          <td>
                            {w.stock
                              ? `${w.stock.amount} ${w.stock.symbol} · ${w.stock.status === "sent" ? "sent" : w.stock.status === "needs_review" ? "under review" : "sending"}`
                              : w.card ? w.card.name : "Winner drawn · card on the way"}
                            {w.card && !w.card.deliverySignature ? <small className="dim"> · waiting for the winner to claim</small> : null}
                          </td>
                          <td>
                            <span className="mono">{shortAddress(w.winner)}</span>
                            <small className="dim"> · {(w.chance * 100).toFixed(w.chance >= 0.1 ? 1 : 2)}% chance</small>
                          </td>
                          <td className="num">{elapsedText(Date.now() - (w.card?.at ?? w.stock?.sentAt ?? w.drawnAt))} ago</td>
                          <td className="num">
                            {w.stock?.signature ? (
                              <a href={`https://solscan.io/tx/${w.stock.signature}`} target="_blank" rel="noopener noreferrer">Tx</a>
                            ) : w.card?.deliverySignature ? (
                              <a href={`https://solscan.io/tx/${w.card.deliverySignature}`} target="_blank" rel="noopener noreferrer">Tx</a>
                            ) : w.card ? (
                              <button className="btn btn--sm btn--accent" type="button" data-claim-card={w.card.mint} data-winner={w.winner}>Claim</button>
                            ) : (
                              <a href={`/api/tokens/${token.mint}/draws?number=${w.number}`} target="_blank" rel="noopener">Verify</a>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="empty-table">No rewards yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="ledger-pair">
              <section className="stack stack--tight" aria-labelledby="votes-title" hidden={sniperCoin}>
                <h2 className="section-title section-title--sm" id="votes-title">Votes</h2>
                <div className="table-wrap" id="ledger-votes">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Wallet</th>
                        <th scope="col">Voted for</th>
                        <th scope="col" className="num">When</th>
                      </tr>
                    </thead>
                    <tbody data-votes-body="">
                      <tr>
                        <td colSpan={3} className="empty-table">Loading holder votes…</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="stack stack--tight" aria-labelledby="holders-title">
                <h2 className="section-title section-title--sm" id="holders-title">Raffle participants</h2>
                <p className="muted">Earned Gravity stays eligible after selling. Selling stops new Gravity accrual.</p>
                <div className="table-wrap" id="ledger-gravity">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Wallet</th>
                        <th scope="col" className="num">Held</th>
                        <th scope="col" aria-sort="descending">Gravity ↓</th>
                      </tr>
                    </thead>
                    <tbody id="gravity-ledger-body">
                      {leaderboard.holders.length ? (
                        leaderboard.holders.slice(0, 100).map((h) => (
                          <tr>
                            <td>
                              <span className="cell-2" title={visibleVotes.has(h.wallet)
                                ? `Votes for ${strategyName(visibleVotes.get(h.wallet)!, catalog || undefined)}` : undefined}>
                                <span className="mono mono--md">{shortAddress(h.wallet)}</span>
                                <small>{h.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${token.symbol}</small>
                              </span>
                            </td>
                            <td className="num">{h.heldSince ? elapsedText(Date.now() - h.heldSince) : "—"}</td>
                            <td>
                              <span className="meter">
                                <span className="bar"><i style={{ width: `${100 * h.probability}%` }} /></span>
                                <b>{(100 * h.probability).toFixed(1)}%</b>
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="empty-table">No indexed eligible holders.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
      <dialog
        className="modal"
        id="vote-modal"
        aria-labelledby="vm-title"
        style={{ width: "min(720px, calc(100vw - 32px))" }}
      >
        <form method="dialog" className="modal__head">
          <div>
            <h2 className="modal__title" id="vm-title">
              Vote for a strategy
            </h2>
            <p className="modal__sub">
              Pick anything. If it leads for 3 minutes it takes over.
            </p>
          </div>
          <button
            className="modal__close"
            value="cancel"
            aria-label="Close"
            id="close-vote"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18"></path>
            </svg>
          </button>
        </form>
        <div className="modal__me" data-modal-me="" id="modal-position"></div>
        <div
          className="modal__list"
          data-builder=""
          id="vote-strategy-builder"
        ></div>
        <div className="modal__foot">
          <p data-modal-msg="" aria-live="polite" id="vote-modal-feedback"></p>
          <button
            className="btn btn--primary"
            type="button"
            data-sign=""
            id="sign-vote"
          >
            Sign Vote
          </button>
        </div>
      </dialog>
    </>
  );
}
