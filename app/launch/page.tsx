/** A free launch: the creator signs in with a wallet and describes the coin. The
 * treasury buys it in the launch bundle and sells right after. */
export default function LaunchPage() {
  return (
    <main className="page" data-seed-launch="">
      <div className="page-head">
        <div>
          <h1 className="page-title">Launch a coin</h1>
          <p className="page-lede">Free. One launch per wallet a day.</p>
        </div>
      </div>
      <form className="panel" id="seed-form" noValidate>
        <div className="panel__body">
          <div className="token-fields">
            <div className="upload-col">
              <label className="upload" id="image-upload">
                Image
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Coin image" id="f-image" />
              </label>
              <button className="btn btn--sm" type="button" id="generate-image" hidden>Generate</button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label label--sm" htmlFor="f-name">Name</label>
                <input className="input input--strong" id="f-name" maxLength={32} autoComplete="off" />
              </div>
              <div className="field">
                <label className="label label--sm" htmlFor="f-ticker">Ticker</label>
                <input className="input input--strong" id="f-ticker" maxLength={13} autoComplete="off" autoCapitalize="off" />
              </div>
              <div className="field span-all">
                <label className="label label--sm" htmlFor="f-desc">Description</label>
                <textarea className="input" id="f-desc" rows={4} maxLength={4000}></textarea>
              </div>
              <div className="field">
                <label className="label label--sm" htmlFor="f-web">Website</label>
                <input className="input" id="f-web" placeholder="https://" autoComplete="off" />
              </div>
              <div className="field">
                <label className="label label--sm" htmlFor="f-x">X</label>
                <input className="input" id="f-x" placeholder="@handle or link" autoComplete="off" />
              </div>
              <div className="field">
                <label className="label label--sm" htmlFor="f-tg">Telegram</label>
                <input className="input" id="f-tg" placeholder="@handle or t.me link" autoComplete="off" />
              </div>
            </div>
          </div>
          <p className="setting-help" id="seed-bundle" role="status"></p>
          <p className="setting-help is-error" id="seed-error" role="alert" hidden></p>
          <div className="actions">
            <button className="btn btn--primary" type="submit" id="seed-submit">Connect wallet and launch</button>
          </div>
        </div>
      </form>
    </main>
  );
}
