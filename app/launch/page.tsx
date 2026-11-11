import { SiteNav } from "../components/site-nav";
import { launchPromo } from "../../src/server/promo";

/** A free launch: the creator signs in with a wallet and describes the coin. The
 * treasury buys it in the launch bundle and sells right after. */
export default function LaunchPage() {
  const promo = launchPromo();
  return (
    <>
      <header className="sky-short">
        <SiteNav current="launch" />
        <div className="docs-hero container">
          {promo ? <div className="hero-tag promo"><svg className="icon" style={{ width: "14px", height: "14px" }}><use href="#i-leaf" /></svg>{promo}</div> : null}
          <h1>Launch a <em>token</em></h1>
          <p>One launch per wallet a day.</p>
        </div>
      </header>
      <main className="container launch-main" data-seed-launch="">
        <form className="card panel launch-form" id="seed-form" noValidate>
          <div className="token-fields">
            <div className="upload-col">
              <label className="upload" id="image-upload">
                <span>Image</span>
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Coin image" id="f-image" />
              </label>
              <button className="btn btn-white btn-xs" type="button" id="generate-image" hidden>Generate</button>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="f-name">Name</label><input id="f-name" maxLength={32} autoComplete="off" /></div>
              <div className="field"><label htmlFor="f-ticker">Ticker</label><input id="f-ticker" maxLength={13} autoComplete="off" autoCapitalize="off" /></div>
              <div className="field span-all"><label htmlFor="f-desc">Description</label><textarea id="f-desc" rows={4} maxLength={4000} placeholder="Who this coin rewards and for what: the cause, the community and the kind of challenges its fees will pay for"></textarea></div>
              <div className="field"><label htmlFor="f-x">X</label><input id="f-x" placeholder="@handle or link" autoComplete="off" /></div>
              <div className="field"><label htmlFor="f-tg">Telegram</label><input id="f-tg" placeholder="@handle or t.me link" autoComplete="off" /></div>
            </div>
          </div>
          <p className="hint" id="seed-bundle" role="status"></p>
          <p className="notice is-error" id="seed-error" role="alert" hidden></p>
          <div className="btn-row">
            <button className="btn btn-primary btn-lg" type="submit" id="seed-submit">Connect wallet and launch</button>
          </div>
        </form>
      </main>
    </>
  );
}
