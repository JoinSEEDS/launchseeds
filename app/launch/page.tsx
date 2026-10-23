import { DESCRIPTION } from "../../lib/strategy";
import { solToLamports } from "../../src/shared/domain";
import { launchTotal } from "../../lib/launch-ui";
import { DESIGN_LAUNCH_FEE_LAMPORTS } from "../../lib/launch-presentation";

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
  const quotedTotal = launchTotal("0.5", fixedFee) || "0.52";
  return (
    <main className="page" data-launch="">
      <div className="page-head">
        <div>
          <h1 className="page-title">Launch a Token</h1>
          <p className="page-lede">
            Name it, pick what its fees do first, and launch with one
            transaction from your wallet.
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
                      Website
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
                      X
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
                      Telegram
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
                <span className="label">First strategy</span>
                <span className="label">
                  Holders can vote to change it any time
                </span>
              </div>
              <div data-builder="" id="first-strategy-root"></div>
            </section>
            <section className="panel">
              <div className="panel__head">
                <label className="label" htmlFor="f-dev">
                  Dev buy
                </label>
              </div>
              <div className="panel__body amount">
                <span className="amount__input">
                  <input
                    id="f-dev"
                    name="devBuy"
                    inputMode="decimal"
                    value="0.5"
                    data-dev-input=""
                  />
                  <span>SOL</span>
                </span>
                <button
                  className="chip"
                  type="button"
                  data-dev="0"
                  aria-pressed="false"
                >
                  0
                </button>
                <button
                  className="chip"
                  type="button"
                  data-dev="0.1"
                  aria-pressed="false"
                >
                  0.1
                </button>
                <button
                  className="chip"
                  type="button"
                  data-dev="0.5"
                  aria-pressed="true"
                >
                  0.5
                </button>
                <button
                  className="chip"
                  type="button"
                  data-dev="1"
                  aria-pressed="false"
                >
                  1
                </button>
              </div>
            </section>
          </form>

          <div
            className="stack"
            data-step="pay"
            hidden
            id="launch-status-panel"
          >
            <section className="panel">
              <div className="panel__head">
                <span className="label">Launch status</span>
                <span
                  className="pill pill--wait"
                  data-pill=""
                  id="launch-status-pill"
                >
                  WAITING
                </span>
              </div>
              <div className="kv">
                <div>
                  <div className="label label--sm">Funding address</div>
                  <div
                    className="kv__value mono mono--md"
                    style={{ fontSize: "16px" }}
                    data-from=""
                    id="payment-address"
                  >
                    —
                  </div>
                </div>
                <div className="kv__item--end">
                  <div className="label label--sm">Amount</div>
                  <div className="kv__value">
                    <span data-total="" id="payment-amount">
                      0.52 SOL
                    </span>
                  </div>
                </div>
              </div>
              <div className="panel__body" id="funding-details" hidden>
                <p className="opt-note">
                  Send only the displayed amount of SOL to this funding address.
                  The launch proceeds after network confirmation.
                </p>
                <div
                  className="btn-row"
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    className="btn"
                    type="button"
                    id="copy-address"
                    hidden
                  >
                    Copy Funding Address
                  </button>
                  <button
                    className="btn btn--primary"
                    type="button"
                    id="pay-with-wallet"
                    hidden
                  >
                    Pay in Wallet
                  </button>
                  <img
                    id="payment-qr"
                    width="132"
                    height="132"
                    alt="Funding address QR"
                    hidden
                  />
                </div>
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
              <ol className="checklist" data-checklist="" id="launch-checklist">
                <li className="is-current">
                  Launch prepared<span></span>
                </li>
                <li>
                  Funding detected<span></span>
                </li>
                <li>
                  Token created<span></span>
                </li>
                <li>
                  Treasury created<span></span>
                </li>
                <li>
                  First strategy set<span></span>
                </li>
              </ol>
              <div className="ballot-foot">
                <p data-launch-msg="" aria-live="polite" id="payment-status">
                  Launch preparation status will appear here.
                </p>
                <div
                  className="btn-row"
                  style={{ display: "flex", gap: "8px" }}
                >
                  <button
                    className="btn"
                    type="button"
                    data-action="edit"
                    hidden
                    id="back-to-form"
                  >
                    Edit Details
                  </button>
                  <button
                    className="btn btn--primary"
                    type="button"
                    data-action="retry"
                    hidden
                    id="retry-launch-status"
                  >
                    Try Again
                  </button>
                  <a
                    className="btn btn--primary"
                    href="/"
                    data-action="open"
                    hidden
                    id="launched-token-link"
                  >
                    <span>
                      Open <span data-bind-ticker="">$TOKEN</span>
                    </span>
                  </a>
                </div>
              </div>
            </section>
          </div>
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
            <div className="panel__body">
              <dl className="dl">
                <dt>Launch fee</dt>
                <dd id="summary-fee">{`${(fixedFee / 1e9).toFixed(2)} SOL`}</dd>
                <dt>Dev buy</dt>
                <dd>
                  <span data-dev-out="" id="summary-dev">
                    0.5
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
                className="btn btn--primary btn--block"
                type="submit"
                form="launch-form"
                id="get-deposit"
                disabled
              >
                Connect Wallet &amp; Launch
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
