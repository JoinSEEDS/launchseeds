/** User-funded launch columns: filled in by lib/launch-columns.ts. */
export function UserBatchControls() {
  return (
    <section className="panel" id="user-batch-controls" hidden>
      <div className="panel__head"><span className="label">03 / Launch columns</span></div>
      <div className="panel__body stack">
        <p className="setting-help">
          Your coin is created and bought in one Jito bundle: the creation, then one buy transaction per column (up to four).
          Each column is signed by one of LaunchSeeds's signing wallets, which is also its first buyer. Add fresh wallets made just for this
          coin and choose what each one buys. You fund every buy and the network reserves.
        </p>
        <div className="launch-columns" id="launch-columns"></div>
        <div className="launch-columns__actions">
          <button className="btn btn--sm" type="button" id="add-column">+ Add column</button>
          <button className="btn btn--sm btn--ghost" type="button" id="columns-import">Import CSV / JSON</button>
          <button className="btn btn--sm btn--ghost" type="button" id="columns-export">Export JSON</button>
          <input type="file" id="columns-import-file" accept=".csv,.json,.txt,text/csv,application/json" hidden />
        </div>
        <p className="setting-help" id="columns-import-status" role="status" hidden></p>
        <details className="setting-help columns-import-help">
          <summary>Import format</summary>
          <p>CSV, one row per wallet: <code>column,sol,sell</code>. A column's first row is its LaunchSeeds signer; its sell rule is the first one
            given (<code>profit 2</code>, <code>time 30</code> or <code>immediate</code>). Add <code>proceeds,&lt;address&gt;</code> for the proceeds wallet.</p>
          <pre className="mono">{"column,sol,sell\n1,0.2,profit 2\n1,0.1\n2,0.15,time 30\nproceeds,<your address>"}</pre>
          <p>JSON, the same as Export JSON: <code>{'{"proceedsWallet":"…","columns":[{"slots":[0.2,0.1],"sell":"profit 2"}]}'}</code></p>
        </details>
        <label className="field">
          <span className="label label--sm">Proceeds wallet</span>
          <input className="input mono" id="f-proceeds-wallet" placeholder="Solana address for every column's principal and profit" autoComplete="off" spellCheck={false} />
        </label>
        <p className="setting-help">
          Each column sells all its wallets together in one transaction, on its own rule. A profit target counts the column's costs and may
          never be reached; timed and immediate sales take the market price and can lose money. After a sale, the column's SOL goes to the
          proceeds wallet: fresh wallets are emptied, and the signer sends exactly what this launch put through it. Nothing buys to force a sale.
        </p>
      </div>
    </section>
  );
}
