import { DESCRIPTION } from "../../lib/strategy";
import { solToLamports } from "../../src/shared/domain";
import { launchTotal } from "../../lib/launch-ui";
import { DESIGN_LAUNCH_FEE_LAMPORTS } from "../../lib/launch-presentation";
import { SNIPER_SECONDS, MARKET_CAP_STOPS, MAX_LIQUIDITY_SHARE } from "../../src/domain/launch-settings";

export default function LaunchPage() {
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
    <main className="page" data-launch="">
      <div className="page-head">
        <div>
          <h1 className="page-title">Launch a Token</h1>
          <p className="page-lede">
            Name it, set how holders govern its fees, and launch it.
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
              </div>
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
                    <button className="btn btn--sm" type="button" id="generate-image" hidden>
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
                        maxLength={10}
                        data-bind="ticker"
                        autoCapitalize="characters"
                      />
                    </div>
                    <div className="field span-all">
                      <label className="label label--sm" htmlFor="f-desc">
                        Description
                      </label>
                      <span className="input-locked">
                        <input
                          className="input"
                          id="f-desc"
                          name="description"
                          value={DESCRIPTION}
                          readOnly
                          aria-readonly="true"
                        />
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#8b94a3"
                          strokeWidth={2.2}
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <rect
                            x="5"
                            y="11"
                            width="14"
                            height="10"
                            rx="2"
                          ></rect>
                          <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="form-grid" style={{ marginTop: "14px" }}>
                  <div className="field">
                    <label className="label label--sm" htmlFor="f-web">
                      Website (optional)
                    </label>
                    <input
                      className="input"
                      id="f-web"
                      name="website"
                      type="url"
                      placeholder="https://"
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

            <section className="panel">
              <div className="panel__head">
                <span className="label">Default strategy</span>
              </div>
              <div data-builder="" id="first-strategy-root"></div>
            </section>
            <section className="panel toggle-panel" data-toggle-panel="pow" id="sniper-protection">
              <div className="panel__head">
                <span className="label" id="t-pow">Sniper protection</span>
                <button className="switch" type="button" role="switch" aria-checked="true" aria-labelledby="t-pow" data-switch=""></button>
              </div>
              <div className="toggle-panel__body">
                <div className="readout"><b data-pow-out="">30s</b><span>to solve on a MacBook</span></div>
                <div className="slider" style={{ "--lo": "0%", "--hi": "50%" }}>
                  <input type="range" min="0" max={String(SNIPER_SECONDS.length - 1)} step="1" value={String(SNIPER_SECONDS.indexOf(30))} data-pow="" id="f-sniper" aria-label="Puzzle time on a MacBook" />
                </div>
                <div className="ticks"><span>1s</span><span>10s</span><span>1 min</span><span>5 min</span></div>
              </div>
            </section>

            <section className="panel toggle-panel" data-toggle-panel="liq" id="launch-liquidity">
              <div className="panel__head">
                <span className="label" id="t-liq">Concentrated liquidity</span>
                <button className="switch" type="button" role="switch" aria-checked="true" aria-labelledby="t-liq" data-switch=""></button>
              </div>
              <div className="toggle-panel__body toggle-panel__body--2">
                <div className="stack stack--tight">
                  <div className="readout"><b><span data-share-out="">25</span>%</b><span>of fees</span></div>
                  <div className="slider slider--blue" style={{ "--lo": "0%", "--hi": "49%" }}>
                    <input type="range" min="1" max={String(MAX_LIQUIDITY_SHARE)} step="1" value="25" data-share="" id="f-liquidity-share" aria-label="Share of fees for liquidity" />
                  </div>
                  <div className="ticks"><span>1%</span><span>25%</span><span>50%</span></div>
                </div>
                <div className="stack stack--tight">
                  <div className="readout"><b data-range-out="">$100K–$1M</b><span>market cap</span></div>
                  <div className="slider slider--blue slider--dual" style={{ "--lo": "25%", "--hi": "50%" }}>
                    <input type="range" min="0" max={String(MARKET_CAP_STOPS.length - 1)} step="1" value={String(MARKET_CAP_STOPS.indexOf(100_000))} data-range-lo="" aria-label="Range from" />
                    <input type="range" min="0" max={String(MARKET_CAP_STOPS.length - 1)} step="1" value={String(MARKET_CAP_STOPS.indexOf(1_000_000))} data-range-hi="" aria-label="Range to" />
                  </div>
                  <div className="ticks"><span>$10K</span><span>$100K</span><span>$1M</span><span>$10M</span><span>$100M</span></div>
                </div>              </div>
            </section>

            <section className="panel toggle-panel is-off" data-toggle-panel="fund" id="reward-fund">
              <div className="panel__head">
                <span className="label" id="t-fund">Initial reward fund</span>
                <button className="switch" type="button" role="switch" aria-checked="false" aria-labelledby="t-fund" data-switch=""></button>
              </div>
              <div className="toggle-panel__body">
                <div className="amount amount--grid">
                  <span className="amount__input">
                    <input id="f-dev" name="devBuy" inputMode="decimal" value="0.5" aria-label="Reward fund in SOL" data-dev-input="" />
                    <span>SOL</span>
                  </span>
                  {["0.1", "0.5", "1", "2"].map((value) => (
                    <button className="chip" type="button" data-dev={value} aria-pressed={String(value === "0.5")}>{value}</button>
                  ))}
                </div>
                <p className="setting-help">Optional. Buys <strong id="reward-fund-ticker">$TOKEN</strong> at launch and puts it in the treasury as a starting reward fund, on top of trading fees.</p>
              </div>
            </section>
          </form>

          <section
            className="panel pay"
            data-step="pay"
            hidden
            id="launch-status-panel"
          >
            <div className="panel__head">
              <span className="label" id="pay-title">Pay to launch</span>
              <span className="busy" id="launch-busy" hidden>
                <span className="spin" aria-hidden="true"></span>
                <span id="launch-busy-text">Waiting for payment</span>
              </span>
            </div>
            <div className="scan" id="launch-scan" aria-hidden="true" hidden><i></i></div>

            <div className="pay__body" id="funding-details" hidden>
              <div className="qr-box">
                <img id="payment-qr" alt="QR code for the payment: scan with a Solana wallet" hidden />
              </div>
              <div className="pay__info">
                <div>
                  <div className="label label--sm">Send exactly</div>
                  <div className="pay__value">
                    <b className="pay__amount" id="payment-amount">—</b>
                    <button className="icon-btn" type="button" id="copy-amount" aria-label="Copy amount">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>
                    </button>
                  </div>
                </div>
                <div>
                  <div className="label label--sm">To</div>
                  <div className="pay__value">
                    <span className="mono pay__addr" id="payment-address">—</span>
                    <button className="icon-btn" type="button" id="copy-address" aria-label="Copy address">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>
                    </button>
                  </div>
                </div>
                <div className="pay__actions">
                  <button className="btn btn--primary" type="button" id="pay-in-wallet">Pay in Wallet</button>
                  <button className="btn" type="button" id="free-launch" hidden>Free Launch</button>
                  <button className="btn" type="button" id="edit-launch-details" hidden>Edit Details</button>
                  <span className="status" id="payment-expiry">Expires in <b id="payment-expires">—</b></span>
                </div>
                <p className="opt-note" id="funding-copy-feedback" role="status" aria-live="polite"></p>
                <p className="opt-note" id="free-launch-status" role="status" aria-live="polite" hidden></p>
                <div className="bar" id="deposit-progress" role="progressbar" aria-label="Funding progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i /></div>
              </div>
            </div>

            <div className="live-card" id="launch-live" hidden>
              <span className="av av--lg" style={{ background: "#2e3b78" }} id="live-avatar">T</span>
              <span className="live-card__main">
                <b className="live-card__title"><span data-bind-ticker="">$TOKEN</span> is live</b>
                <span className="addr"><span className="mono" id="live-ca">—</span><button className="btn-copy" type="button" data-copy="" id="live-ca-copy">Copy</button></span>
              </span>
              <span className="live-card__actions">
                <a className="btn" href="https://x.com/intent/post" target="_blank" rel="noopener" id="share-on-x">Share on X</a>
                <a className="btn btn--primary" href="/" id="launched-token-link"><span>Open <span data-bind-ticker="">$TOKEN</span></span></a>
              </span>
            </div>

            <ol className="checklist" data-checklist="" id="launch-checklist" aria-live="polite">
              <li className="is-current" id="step-payment">Payment received</li>
              <li id="step-token">Token created</li>
              <li id="step-treasury">Treasury created</li>
              <li id="step-strategy">Strategy and rules set</li>
              <li id="dev-buy-step">Reward fund added to treasury: <span id="reward-fund-amount">0 SOL</span></li>
            </ol>
            <div className="ballot-foot">
              <p data-launch-msg="" aria-live="polite" id="payment-status">
                Launch preparation status will appear here.
              </p>
              <div className="btn-row" style={{ display: "flex", gap: "8px" }}>
                <a className="btn" href="/" id="back-to-form">Back to launchpad</a>
                <button className="btn btn--primary" type="button" data-action="retry" hidden id="retry-launch-status">
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
            <div
              className="panel__body"
              style={{ borderBottom: "1px solid var(--line-soft)" }}
            >
              <div className="label label--sm" style={{ marginBottom: "10px" }}>
                Starts with
              </div>
              <div data-first-out="" id="launch-first-preview"></div>
            </div>
            <div className="panel__body summary-block">
              <dl className="dl" id="summary-rules"></dl>
            </div>
            <div className="panel__body summary-block">
              <div className="label label--sm">Fees</div>
              <div className="split-bar" id="launch-fee-split" role="img" aria-label="10% to $TOKEN, 25% to liquidity, 65% to holder rewards"></div>
              <div className="split-legend" id="launch-fee-legend"></div>
              <p className="setting-help">$TOKEN first, then liquidity; the rest goes to holder rewards.</p>
            </div>
            <div className="panel__body">
              <dl className="dl">
                <dt>Launch fee</dt>
                <dd id="summary-fee">{`${(fixedFee / 1e9).toFixed(2)} SOL`}</dd>
                <dt>Reward fund</dt>
                <dd>
                  <span data-dev-out="" id="summary-dev">
                    0
                  </span>{" "}
                  SOL
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
