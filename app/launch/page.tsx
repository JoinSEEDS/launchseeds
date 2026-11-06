import { currentBrand } from "../../src/server/site-brand";
import { DESCRIPTION } from "../../lib/strategy";
import { UserBatchControls } from "../components/user-batch-controls";
import { solToLamports } from "../../src/shared/domain";
import { launchTotal } from "../../lib/launch-ui";
import { DESIGN_LAUNCH_FEE_LAMPORTS } from "../../lib/launch-presentation";
import {
  SNIPER_SECONDS,
  MARKET_CAP_STOPS,
  MAX_LIQUIDITY_SHARE,
  LIQUIDITY_AVAILABLE,
  BUNDLE_STOPS_SOL,
  BUNDLE_DEFAULT_LAMPORTS,
  BUNDLE_EXIT_PERCENTS,
  BUNDLE_DEFAULT_EXIT_PERCENT,
  BUNDLE_HOLD_LIMITS_MS,
  durationText,
} from "../../src/domain/launch-settings";

export default function LaunchPage() {
  const brand = currentBrand();
  // This is a display quote, not a readiness signal. The API independently
  // checks worker/RPC health before allowing a launch to be prepared.
  let fixedFee = DESIGN_LAUNCH_FEE_LAMPORTS;
  try {
    const amount = process.env.LAUNCH_BASE_SOL;
    if (amount) fixedFee = solToLamports(amount);
  } catch {
    /* Leave unconfigured quotes unspecified rather than invent them. */
  }
  const quotedTotal = launchTotal("0", fixedFee) || "0.02";
  return (
    <main className="page" data-launch="" data-scheduled-launch="" data-brand={brand.kind}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Schedule a launch</h1>
          <p className="page-lede">
            Choose the time, publish each wallet's buy and set where the profits
            go.
          </p>
        </div>
      </div>
      <div className="split split--flush">
        <div className="split__main split__main--stack">
          <form
            id="launch-form"
            className="stack"
            data-step="details"
            noValidate
          >
            <section className="panel">
              <div className="panel__head">
                <span className="label">Token</span>
                <button
                  className="btn btn--sm btn--ghost"
                  type="button"
                  id="open-clone"
                >
                  Clone a coin
                </button>
              </div>
              <p
                className="setting-help clone-status"
                id="clone-result"
                role="status"
                hidden
              ></p>
              <div className="panel__body">
                <div className="token-fields">
                  <div className="upload-col">
                    <label className="upload" id="image-upload">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#8b94a3"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                      {"\n                    Image\n                    "}
                      <input
                        type="file"
                        name="image"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        data-image-input=""
                        aria-label="Token image"
                        id="f-image"
                      />
                    </label>
                    <button
                      className="btn btn--sm"
                      type="button"
                      id="generate-image"
                      hidden
                    >
                      Generate
                    </button>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label className="label label--sm" htmlFor="f-name">
                        Name
                      </label>
                      <input
                        className="input input--strong"
                        id="f-name"
                        name="name"
                        value=""
                        required
                        maxLength={32}
                        data-bind="name"
                      />
                    </div>
                    <div className="field">
                      <label className="label label--sm" htmlFor="f-ticker">
                        Ticker
                      </label>
                      <input
                        className="input input--strong"
                        id="f-ticker"
                        name="ticker"
                        value=""
                        required
                        maxLength={13}
                        data-bind="ticker"
                        autoCapitalize="off"
                      />
                    </div>
                    <div className="field span-all">
                      <span className="field-head">
                        <label className="label label--sm" htmlFor="f-desc">
                          About your project
                        </label>
                        <label className="check">
                          <input type="checkbox" id="f-desc-own" data-override="f-desc" />
                          Write my own
                        </label>
                      </span>
                      <span className="input-locked">
                        <textarea className="input" id="f-desc" name="description" rows={6} maxLength={4000} readOnly aria-readonly="true"
                          data-default={DESCRIPTION} placeholder="Describe your project, purpose and launch plans…">{DESCRIPTION}</textarea>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b94a3" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="10" rx="2"></rect>
                          <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                        </svg>
                      </span>
                      <p className="setting-help">The LaunchSeeds default unless you tick “Write my own” (up to 4,000 characters). You can edit it before funding locks the plan.</p>
                    </div>
                  </div>
                </div>
                <div className="form-grid" style={{ marginTop: "14px" }}>
                  <div className="field">
                    <span className="field-head">
                      <label className="label label--sm" htmlFor="f-web">
                        Website
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          id="f-web-own"
                          data-override="f-web"
                        />
                        My own
                      </label>
                    </span>
                    <input
                      className="input"
                      id="f-web"
                      name="website"
                      type="url"
                      readOnly
                      data-default=""
                      placeholder="launchseeds.xyz/coin/<CA>"
                      title="Set automatically to this new coin’s LaunchSeeds page, unless you use your own"
                    />
                  </div>
                  <div className="field">
                    <label className="label label--sm" htmlFor="f-x">
                      X (optional)
                    </label>
                    <input
                      className="input"
                      id="f-x"
                      name="x"
                      placeholder="@handle"
                    />
                  </div>
                  <div className="field">
                    <label className="label label--sm" htmlFor="f-tg">
                      Telegram (optional)
                    </label>
                    <input
                      className="input"
                      id="f-tg"
                      name="telegram"
                      placeholder="t.me/"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="panel" id="schedule-controls">
              <div className="panel__head">
                <span className="label">01 / Launch time</span>
              </div>
              <div className="panel__body stack">
                <label className="field"><span className="label label--sm">Schedule by</span><select className="input" id="f-time-mode"><option value="minutes">Minutes from now</option><option value="date">Date and time</option></select></label>
                <label className="field" id="launch-minutes-field"><span className="label label--sm">Launch in how many minutes?</span><input className="input" id="f-launch-minutes" type="number" min="3" max="10080" step="1" value="30" /><span className="setting-help">3 minutes to 7 days. The exact launch time locks when the payment quote is prepared.</span></label>
                <label className="field" id="launch-date-field" hidden>
                  <span className="label label--sm">Your local time</span>
                  <input
                    className="input"
                    id="f-scheduled-at"
                    type="datetime-local"
                    required
                    aria-describedby="schedule-timezone"
                  />
                </label>
                <p className="setting-help" id="schedule-timezone">
                  Your timezone will appear here. The public plan records UTC.
                </p>
                <p className="setting-help">
                  Pay before the scheduled time. The worker starts execution
                  when it is due; chain inclusion may be later.
                </p>
              </div>
            </section>
            <section
              className="panel toggle-panel"
              data-toggle-panel="bundle"
              id="sniper-protection"
            >
              <div className="panel__head">
                <span className="label" id="t-bundle">
                  02 / Protection buy
                </span>
                <button
                  className="switch"
                  type="button"
                  role="switch"
                  aria-checked="true"
                  aria-labelledby="t-bundle"
                  data-switch=""
                  hidden
                ></button>
              </div>
              <p
                className="protection-budget"
                id="bundle-capacity"
                role="status"
              >
                Checking available protection…
              </p>
              <div className="toggle-panel__body">
                <div className="readout">
                  <b data-bundle-out="">0.5 SOL</b>
                  <span>bought at launch</span>
                </div>
                <div className="slider" style={{ "--lo": "0%", "--hi": "33%" }}>
                  <input
                    type="range"
                    min="0"
                    max={String(BUNDLE_STOPS_SOL.length - 1)}
                    step="1"
                    value={String(
                      BUNDLE_STOPS_SOL.indexOf(
                        (BUNDLE_DEFAULT_LAMPORTS / 1e9) as never,
                      ),
                    )}
                    data-bundle=""
                    id="f-bundle"
                    aria-label="Sniper protection size in SOL"
                  />
                </div>
                <div className="ticks" id="bundle-ticks">
                  {BUNDLE_STOPS_SOL.map((sol) => (
                    <span>{String(sol)}</span>
                  ))}
                </div>
                <div className="allocation-heading">
                  <span className="label label--sm">
                    Distribute 100% across the wallets
                  </span>
                  <b id="allocation-total">100%</b>
                </div>
                <div className="plan-wallets allocation-inputs">
                  {["33.34", "33.33", "33.33"].map((value, i) => (
                    <label className="plan-wallet field">
                      <span className="label label--sm">Wallet {i + 1}</span>
                      <span className="amount__input">
                        <input
                          className="input"
                          id={`f-wallet-share-${i}`}
                          type="number"
                          min="0.01"
                          max="99.98"
                          step="0.01"
                          value={value}
                          aria-label={`Wallet ${i + 1} allocation percent`}
                        />
                        <span>%</span>
                      </span>
                      <output id={`wallet-buy-${i}`}>Calculating...</output>
                    </label>
                  ))}
                </div>
                <p className="setting-help">
                  Each wallet must buy at least 0.03 SOL. Allocations must total
                  100%.
                </p>
                <div className="field" id="legacy-exit-controls">
                  <span className="label label--sm" id="l-exit">
                    Profit target per wallet (before costs)
                  </span>
                  <div className="chips" role="group" aria-labelledby="l-exit">
                    {BUNDLE_EXIT_PERCENTS.map((value) => (
                      <button
                        className="chip"
                        type="button"
                        data-exit={String(value)}
                        aria-pressed={String(
                          value === BUNDLE_DEFAULT_EXIT_PERCENT,
                        )}
                      >{`+${value - 100}%`}</button>
                    ))}
                  </div>
                </div>
                <details className="execution-details">
                  <summary>How execution works</summary>
                  <ol
                    className="bundle-how"
                    id="bundle-how"
                    aria-label="How sniper protection works"
                  >
                    <li>
                      Your coin is created and <b data-how-size="">0.5 SOL</b>{" "}
                      of it is bought in the same Jito bundle, from three new
                      public wallets funded by LaunchSeeds. No sniper can buy before
                      them.
                    </li>
                    <li>
                      Prepared sales execute together once every wallet can
                      receive <b data-how-exit="">102%</b> of its buy (
                      <b data-how-back="">0.51 SOL</b> in all).
                    </li>
                    <li data-how-hold="" hidden>
                      If that hasn't happened after <b data-how-limit="">24h</b>
                      , they sell at market.
                    </li>
                    <li>
                      Each wallet's buy, allocation and minimum sale return are
                      published before launch.
                    </li>
                    <li>
                      Realized profit follows the destination in your published
                      plan, after execution costs.
                    </li>
                    <li>
                      You pay only <strong id="bundle-fee">0.015 SOL</strong>{" "}
                      (3%). The buy itself is LaunchSeeds's money and returns to
                      LaunchSeeds.
                    </li>
                  </ol>
                </details>
              </div>
            </section>

            <section className="panel" id="fee-mode-controls">
  <div className="panel__head"><span className="label">Trading fees</span></div>
  <div className="panel__body stack">
    <label className="field"><span>Fee destination</span><select className="input" id="f-fee-mode"><option value="holders">Holder rewards (default)</option><option value="creator">Creator fees to a wallet</option></select></label>
    <label className="field" id="creator-fees-field" hidden><span>Creator-fee wallet</span><input className="input mono" id="f-fees-to" placeholder="Solana public address" autoComplete="off" spellCheck={false}/></label>
    <label className="field"><span>Deployer private key (optional)</span><input className="input mono" id="f-deployer-key" type="password" placeholder="Empty: a new wallet deploys" autoComplete="off" spellCheck={false}/></label>
    <p className="setting-help">Pump pays trading fees to holders in holder-reward mode. Creator-fee mode uses the wallet you enter instead. This choice is published with the reserved CA and locks when payment arrives.</p>
  </div>
</section>
<UserBatchControls />
<section className="panel" id="profit-controls">
              <div className="panel__head">
                <span className="label">03 / Profit destination</span>
              </div>
              <div className="panel__body stack">
                <label className="field">
                  <span className="label label--sm">
                    After the protection wallets sell
                  </span>
                  <select className="input" id="f-profit-mode">
                    <option value="burn">Buy this token &amp; burn</option>
                    <option value="wallet">Send SOL to a wallet</option>
                    {brand.kind === "launchseeds" ? <option value="token">Buy back for a $TOKEN holder (approval required)</option> : null}
                    <option value="cashback" disabled>
                      Cashback to holders - rules pending
                    </option>
                  </select>
                </label>
                <fieldset className="stack" id="boost-controls" style={{minWidth:0,margin:0,padding:0,border:0}}>
  <legend className="label label--sm">BOOST / post-sale buybacks</legend>
  <label className="field"><span>Duration in minutes</span><input className="input" id="f-boost-minutes" type="number" min="1" max="43200" step="1" value="1440" /></label>
  <label className="field"><span>Maximum number of buys</span><input className="input" id="f-boost-steps" type="number" min="1" max="100" step="1" value="24" /></label>
  <p className="setting-help">Starts after the protection sale settles. Use 5 minutes for a short BOOST or 1440 for 24 hours. Purchases are evenly scheduled; small budgets use fewer buys. One buy executes immediately. This does not buy to trigger the protection sale.</p>
</fieldset>
<label className="field" id="profit-wallet-field" hidden>
                  <span className="label label--sm">Profit wallet</span>
                  <input
                    className="input mono"
                    id="f-profit-wallet"
                    placeholder="Solana address"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="setting-help">
                  LaunchSeeds's capital returns to the fund. Only realized profit is
                  routed, after costs. The destination locks when payment
                  arrives.
                </p>
              </div>
            </section>
          </form>

          <div id="funded-plan-preview" hidden></div>
          <dialog
            className="modal"
            id="clone-dialog"
            aria-labelledby="clone-title"
            style={{ width: "min(520px, calc(100vw - 32px))" }}
          >
            <form method="dialog" className="modal__head">
              <div>
                <h2 className="modal__title" id="clone-title">
                  Clone a coin
                </h2>
                <p className="modal__sub">
                  Paste a coin's contract address. Its name, ticker, image and
                  links fill the form; you can edit them before launching. It
                  launches as a new coin.
                </p>
              </div>
              <button
                className="modal__close"
                value="cancel"
                aria-label="Close"
              >
                ✕
              </button>
            </form>
            <div className="panel__body stack stack--tight">
              <div className="clone-row">
                <input
                  className="input"
                  id="f-clone"
                  placeholder="Contract address"
                  aria-label="Contract address of a coin to clone"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="btn btn--sm" type="button" id="clone-btn">
                  Clone
                </button>
              </div>
              <p
                className="setting-help clone-status"
                id="clone-status"
                role="status"
                hidden
              ></p>
            </div>
          </dialog>

          <section
            className="panel pay"
            data-step="pay"
            hidden
            id="launch-status-panel"
          >
            <div className="panel__head">
              <span className="label" id="pay-title">
                Pay to launch
              </span>
              <span className="busy" id="launch-busy" hidden>
                <span className="spin" aria-hidden="true"></span>
                <span id="launch-busy-text">Waiting for payment</span>
              </span>
            </div>
            <div className="scan" id="launch-scan" aria-hidden="true" hidden>
              <i></i>
            </div>

            <div className="pay__body" id="funding-details" hidden>
              <div className="qr-box">
                <img
                  id="payment-qr"
                  alt="QR code for the payment: scan with a Solana wallet"
                  hidden
                />
              </div>
              <div className="pay__info">
                <div>
                  <div className="label label--sm">Send exactly</div>
                  <div className="pay__value">
                    <b className="pay__amount" id="payment-amount">
                      —
                    </b>
                    <button
                      className="icon-btn"
                      type="button"
                      id="copy-amount"
                      aria-label="Copy amount"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                        <path d="M5 15V5a2 2 0 0 1 2-2h8"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <div className="label label--sm">To</div>
                  <div className="pay__value">
                    <span className="mono pay__addr" id="payment-address">
                      —
                    </span>
                    <button
                      className="icon-btn"
                      type="button"
                      id="copy-address"
                      aria-label="Copy address"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                        <path d="M5 15V5a2 2 0 0 1 2-2h8"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="pay__actions">
                  <button
                    className="btn btn--primary"
                    type="button"
                    id="pay-in-wallet"
                  >
                    Pay in Wallet
                  </button>
                  <button
                    className="btn btn--accent retired-free-launch"
                    type="button"
                    id="free-launch"
                    hidden
                  >
                    Mine Free Launch
                  </button>
                  <button
                    className="btn"
                    type="button"
                    id="edit-launch-details"
                    hidden
                  >
                    Edit Details
                  </button>
                  <span className="status" id="payment-expiry">
                    Expires in <b id="payment-expires">—</b>
                  </span>
                </div>
                <p
                  className="opt-note"
                  id="funding-copy-feedback"
                  role="status"
                  aria-live="polite"
                ></p>
                <p
                  className="opt-note"
                  id="free-launch-status"
                  role="status"
                  aria-live="polite"
                  hidden
                ></p>
                <div
                  className="bar"
                  id="deposit-progress"
                  role="progressbar"
                  aria-label="Funding progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow="0"
                  hidden
                >
                  <i />
                </div>
              </div>
            </div>

            <div className="mine" id="mine" hidden>
              <div className="mine__head">
                <span className="mine__text">
                  <b id="mine-title">Mine a free launch</b>
                  <span id="mine-sub"></span>
                </span>
                <button
                  className="btn btn--primary"
                  type="button"
                  id="mine-start"
                >
                  Start Mining
                </button>
                <button className="btn" type="button" id="mine-stop" hidden>
                  Stop
                </button>
              </div>
              <div className="mine__stats" id="mine-stats" hidden>
                <div>
                  <div className="label label--sm">Speed</div>
                  <b id="mine-speed">—</b>
                </div>
                <div>
                  <div className="label label--sm">Hashes</div>
                  <b id="mine-hashes">0</b>
                </div>
                <div>
                  <div className="label label--sm">Time</div>
                  <b id="mine-time">0:00</b>
                </div>
                <div>
                  <div className="label label--sm">Expected</div>
                  <b id="mine-expected">—</b>
                </div>
              </div>
              <div className="mine__hashes mono" id="mine-rows" hidden>
                <span>
                  <i>Target</i>
                  <span id="mine-target"></span>
                </span>
                <span>
                  <i>Best</i>
                  <span id="mine-best">—</span>
                </span>
                <span>
                  <i>Now</i>
                  <span id="mine-now">—</span>
                </span>
              </div>
              <div className="wide-bar mine__bar" id="mine-bar" hidden>
                <div
                  className="bar"
                  role="progressbar"
                  aria-label="Share of expected work done"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <i id="mine-work" />
                </div>
                <small>
                  <span id="mine-work-text">0% of expected work</span>
                  <span>
                    Free launch pool <b id="mine-pool">—</b>
                  </span>
                </small>
              </div>
            </div>

            <div className="live-card" id="launch-live" hidden>
              <span
                className="av av--lg"
                style={{ background: "#2e3b78" }}
                id="live-avatar"
              >
                T
              </span>
              <span className="live-card__main">
                <b className="live-card__title">
                  <span data-bind-ticker="">$TOKEN</span> is live
                </b>
                <span className="addr">
                  <span className="mono" id="live-ca">
                    —
                  </span>
                  <button
                    className="btn-copy"
                    type="button"
                    data-copy=""
                    id="live-ca-copy"
                  >
                    Copy
                  </button>
                </span>
              </span>
              <span className="live-card__actions">
                <a
                  className="btn"
                  href="https://x.com/intent/post"
                  target="_blank"
                  rel="noopener"
                  id="share-on-x"
                >
                  Share on X
                </a>
                <a
                  className="btn btn--primary"
                  href="/"
                  id="launched-token-link"
                >
                  <span>
                    Open <span data-bind-ticker="">$TOKEN</span>
                  </span>
                </a>
              </span>
            </div>

            <ol
              className="checklist"
              data-checklist=""
              id="launch-checklist"
              aria-live="polite"
            >
              <li className="is-current" id="step-payment">
                Payment received
              </li>
              <li id="step-token">Token created</li>
              <li id="step-treasury">Protection wallets prepared</li>
              <li id="step-strategy">Published plan recorded</li>
              <li id="dev-buy-step">
                Reward fund added to treasury:{" "}
                <span id="reward-fund-amount">0 SOL</span>
              </li>
            </ol>
            <div className="ballot-foot">
              <p data-launch-msg="" aria-live="polite" id="payment-status">
                Launch preparation status will appear here.
              </p>
              <div className="btn-row" style={{ display: "flex", gap: "8px" }}>
                <a className="btn" href="/" id="back-to-form">
                  Back to launchpad
                </a>
                <button
                  className="btn btn--primary"
                  type="button"
                  data-action="retry"
                  hidden
                  id="retry-launch-status"
                >
                  Try Again
                </button>
              </div>
            </div>
          </section>
        </div>
        <aside className="split__side">
          <section className="panel">
            <div className="panel__head">
              <span className="label">Summary</span>
            </div>
            <div className="summary-token">
              <span
                className="av av--md"
                style={{ background: "#2e3b78" }}
                data-avatar=""
                id="launch-avatar"
              >
                T
              </span>
              <span>
                <span
                  className="token__name"
                  data-bind-ticker=""
                  id="summary-ticker"
                >
                  $TOKEN
                </span>
                <span
                  className="token__sub"
                  data-bind-name=""
                  id="summary-name"
                >
                  Untitled
                </span>
              </span>
            </div>
            <div className="panel__body summary-block">
              <div id="reserved-ca-preview" hidden><span className="label label--sm">Reserved CA</span><p className="mono" id="reserved-ca-value" style={{overflowWrap:"anywhere"}}></p><button className="btn-copy" type="button" id="reserved-ca-copy">Copy CA</button></div>
              <dl className="dl" id="summary-rules"></dl>
            </div>
            <div className="panel__body">
              <dl className="dl">
                <dt>Launch fee</dt>
                <dd id="summary-fee">{`${(fixedFee / 1e9).toFixed(2)} SOL`}</dd>
                <dt data-summary-bundle="" hidden id="summary-bundle-label">
                  Sniper protection (3%)
                </dt>
                <dd data-summary-bundle="" hidden id="summary-bundle-fee">
                  0 SOL
                </dd>
                <dt className="total label label--sm">Total</dt>
                <dd className="total">
                  <span data-total="" id="summary-total">
                    {quotedTotal}
                  </span>{" "}
                  SOL
                </dd>
              </dl>
            </div>
            <p id="launch-error" className="opt-note" role="alert" hidden></p>
            <p
              id="launch-ready-hint"
              className="opt-note launch-unavailable"
              role="status"
            >
              Checking launch availability…
            </p>
            <button id="recheck-launch" className="btn" type="button" hidden>
              Check availability again
            </button>
            <div
              className="panel__body"
              style={{ paddingTop: "0" }}
              data-submit-wrap=""
              id="submit-wrap"
              hidden
            >
              <button
                className="btn btn--primary btn--block btn--tall"
                type="submit"
                form="launch-form"
                id="get-deposit"
                disabled
              >
                Continue to Payment
              </button>
            </div>
          </section>
          <ol className="steps panel" aria-label="Launch steps" data-steps="">
            <li className="is-current" id="step-details">
              <span>1</span>Details
            </li>
            <li id="step-deposit">
              <span>2</span>Confirm
            </li>
            <li id="step-live">
              <span>3</span>Live
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
