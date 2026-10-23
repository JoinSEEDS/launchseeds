import { getStore } from "../../../src/server/runtime";
import { strategyBoard } from "../../../lib/governance";
import { getCatalog } from "../../../src/server/catalog";
import { strategyName } from "../../../lib/strategy";
import {
  quoteStrategy,
  calculateReadiness,
} from "../../../lib/treasury-readiness";
import { initials, shortAddress } from "../../../lib/format";
import { getMintMarketCap } from "../../../src/server/token-market";

export default async function TokenPage({
  params,
}: {
  params: { id: string };
}) {
  const uid = params.id,
    store = getStore();
  let token: ReturnType<typeof store.token>;
  try {
    token = store.token(uid);
  } catch {
    return (
      <main className="page">
        <h1 className="page-title">Token not found</h1>
        <a href="/">Launchpad</a>
      </main>
    );
  }
  if (token.status !== "live")
    return (
      <main className="page">
        <h1 className="page-title">Launch pending</h1>
        <p className="page-lede">The launch has not been confirmed yet.</p>
        <a href={`/launch?uid=${encodeURIComponent(uid)}`} className="btn">
          View launch status
        </a>
      </main>
    );
  const board = strategyBoard(uid),
    catalog = await getCatalog().catch(() => null);
  const active = board?.active;
  const ready = active
    ? calculateReadiness(
        active,
        quoteStrategy(active, catalog, Date.now()),
        {
          tokenUid: uid,
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
  const cost =
    ready?.quote.costMicros === null || !ready
      ? null
      : ready.quote.costMicros / 1e6;
  const pct = ready?.progressPercent ?? 0;
  const marketCap = await getMintMarketCap(token.mint, token.priceUsd);
  const leaderboard = store.leaderboard(token.id);
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
      <main className="page" id="governed-token" data-token-uid={uid}>
        <div className="page-head">
          <span className="av av--lg" style={{ background: "#2e3b78" }}>
            {token.image ? (
              <img className="avatar-image" src={token.image} alt="" />
            ) : (
              initials(token.name)
            )}
          </span>
          <div>
            <h1 className="page-title">${token.symbol} Treasury</h1>
            <p className="page-lede">
              Holders vote on what this token's fees do. Each reward is funded
              by its treasury.
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
                  href={`https://x.com/${token.x.replace(/^@/, "")}`}
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
              <div className="kv__value">{marketCap ?? "—"}</div>
            </div>
            <div>
              <div className="label label--sm">Active holders</div>
              <div className="kv__value">
                {leaderboard.holders.length.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="label label--sm">CA</div>
              <div className="kv__value mono">
                <button
                  className="btn-copy"
                  data-copy={token.mint}
                  type="button"
                  aria-label="Copy contract address"
                >
                  {shortAddress(token.mint)}
                </button>
              </div>
            </div>
          </div>
        </div>
        <section className="panel">
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
              <div className="label label--sm">Waiting to pay out</div>
              <div className="treasury__amount">
                <b id="treasury-available">${available.toFixed(2)}</b>
                <span id="treasury-needed">
                  {cost === null ? "Awaiting price" : `of $${cost.toFixed(2)}`}
                </span>
              </div>
            </div>
            <div className="treasury__rule" aria-hidden="true" />
            <div className="treasury__active">
              <span
                className="strat-ic"
                style={{ "--c": "var(--accent)" } as any}
              >
                ↗
              </span>
              <span>
                <span className="label label--sm">
                  Active strategy{" "}
                  <span className="pill pill--active pill--sm">SELECTED</span>
                </span>
                <b id="active-strategy">{title}</b>
                <small id="next-reward-name">Next: {title}</small>
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
              <span id="next-reward-deficit">
                {cost === null
                  ? "Fresh price unavailable"
                  : `$${Math.max(0, cost - available).toFixed(2)} to go`}
              </span>
              <span>No confirmed rewards</span>
            </small>
            <p
              className="treasury-verification"
              id="treasury-verification"
              hidden
            ></p>
          </div>
        </section>
        <div className="split">
          <aside className="split__side">
            <section
              className="panel panel__body--roomy position"
              data-position=""
              aria-live="polite"
              id="position-panel"
            >
              <div className="label">Your position</div>
              <div data-when="disconnected" id="holder-disconnected">
                <h2 className="position-title">Connect to vote</h2>
                <p className="position-text">
                  Your vote weighs as much as your gravity. Signing is free;
                  nothing is sent.
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

            <section className="panel panel__body--roomy">
              <div className="label">Last reward</div>
              <p className="cta-text">
                No confirmed rewards have been recorded.
              </p>
            </section>
          </aside>
          <div className="split__main split__main--stack">
            <section
              className="stack stack--tight"
              aria-labelledby="vote-title"
            >
              <h2 className="section-title" id="vote-title">
                Strategy Vote
              </h2>
              <div className="ledger-bar">
                <span className="status">
                  <span className="pill">LIVE</span>
                  <span>
                    <b
                      style={{ color: "var(--text-hi)" }}
                      data-voters=""
                      id="voter-count"
                    >
                      0
                    </b>{" "}
                    voters,{" "}
                    <b
                      style={{ color: "var(--text-hi)" }}
                      data-turnout=""
                      id="strategy-turnout"
                    >
                      0%
                    </b>{" "}
                    of gravity
                  </span>
                </span>
                <span className="status"></span>
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

            <section
              className="stack stack--tight"
              aria-labelledby="ledger-title"
            >
              <h2 className="section-title" id="ledger-title">
                Ledger
              </h2>
              <div className="ledger-bar">
                <div className="tabs" role="tablist" aria-label="Ledger views">
                  <button
                    className="tab"
                    role="tab"
                    id="tab-rewards"
                    aria-controls="ledger-rewards"
                    aria-selected="true"
                    type="button"
                    data-ledger="rewards"
                  >
                    Rewards
                  </button>
                  <button
                    className="tab"
                    role="tab"
                    id="tab-votes"
                    aria-controls="ledger-votes"
                    aria-selected="false"
                    type="button"
                    tabIndex={-1}
                    data-ledger="votes"
                  >
                    Votes
                  </button>
                  <button
                    className="tab"
                    role="tab"
                    id="tab-gravity"
                    aria-controls="ledger-gravity"
                    aria-selected="false"
                    type="button"
                    tabIndex={-1}
                    data-ledger="gravity"
                  >
                    Gravity
                  </button>
                </div>
                <span className="status" id="votes-updated">
                  Votes refresh automatically
                </span>
              </div>

              <div
                className="table-wrap"
                role="tabpanel"
                id="ledger-rewards"
                aria-labelledby="tab-rewards"
              >
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Strategy</th>
                      <th scope="col" className="num">
                        Spent
                      </th>
                      <th scope="col">Result</th>
                      <th scope="col">Recipient</th>
                      <th scope="col" className="num">
                        When
                      </th>
                      <th scope="col" className="num">
                        <span className="sr-only">Transaction</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {
                      <tr>
                        <td colSpan={7} className="empty-table">
                          No confirmed treasury executions.
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div
                className="table-wrap"
                role="tabpanel"
                id="ledger-votes"
                aria-labelledby="tab-votes"
                hidden
              >
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Wallet</th>
                      <th scope="col">Voted for</th>
                      <th scope="col" className="num">
                        Gravity
                      </th>
                      <th scope="col" className="num">
                        Weight
                      </th>
                      <th scope="col" className="num">
                        When
                      </th>
                    </tr>
                  </thead>
                  <tbody data-votes-body="">
                    {
                      <tr>
                        <td colSpan={5} className="empty-table">
                          Loading holder votes…
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div
                className="table-wrap"
                role="tabpanel"
                id="ledger-gravity"
                aria-labelledby="tab-gravity"
                hidden
              >
                <div className="table-top">
                  <div className="table-top__row">
                    <span className="label label--sm">Gravity share</span>
                    <span className="label label--sm">Indexed holders</span>
                  </div>
                  <div
                    className="odds"
                    role="img"
                    aria-label="Gravity distribution across active holders"
                  ></div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Wallet</th>
                      <th scope="col" className="num">
                        $SLAB
                      </th>
                      <th scope="col" className="num">
                        Held
                      </th>
                      <th scope="col" className="num">
                        Gravity
                      </th>
                      <th scope="col" aria-sort="descending">
                        Share ↓
                      </th>
                      <th scope="col">Vote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.holders.length ? (
                      leaderboard.holders.slice(0, 100).map((h, i) => (
                        <tr>
                          <td className="dim">{i + 1}</td>
                          <td className="mono mono--md">
                            {shortAddress(h.wallet)}
                          </td>
                          <td className="num">{h.balance.toLocaleString()}</td>
                          <td className="num">—</td>
                          <td className="num">{h.gravity.toLocaleString()}</td>
                          <td>
                            <span className="meter">
                              <span className="bar">
                                <i
                                  style={{ width: `${100 * h.probability}%` }}
                                />
                              </span>
                              <b>{(100 * h.probability).toFixed(1)}%</b>
                            </span>
                          </td>
                          <td>
                            {visibleVotes.has(h.wallet)
                              ? strategyName(
                                  visibleVotes.get(h.wallet)!,
                                  catalog || undefined,
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="empty-table">
                          No indexed eligible holders.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
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
