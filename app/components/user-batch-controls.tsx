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
        <div className="launch-columns__actions">
          <button className="btn btn--sm" type="button" id="mode-simple" aria-pressed="true">Simple</button>
          <button className="btn btn--sm btn--ghost" type="button" id="mode-advanced" aria-pressed="false" title="Set every wallet's buy and sell rule by hand. Starts from your simple setup; going back to Simple replaces these changes.">Advanced</button>
        </div>
        <div className="stack" id="launch-simple"></div>
        <div className="launch-columns" id="launch-columns"></div>
        <div className="launch-columns" id="launch-tranches" hidden></div>
        <div className="launch-columns__actions">
          <button className="btn btn--sm" type="button" id="add-column">+ Add column</button>
          <button className="btn btn--sm" type="button" id="add-tranche" title="A buy after the launch, outside the bundle: one transaction with its own fresh wallets, fired some seconds after launch or at a market cap">+ Add tranche</button>
          <button className="btn btn--sm btn--ghost" type="button" id="columns-import">Import CSV / JSON</button>
          <button className="btn btn--sm btn--ghost" type="button" id="columns-export">Export JSON</button>
          <input type="file" id="columns-import-file" accept=".csv,.json,.txt,text/csv,application/json" hidden />
        </div>
        <p className="setting-help" id="columns-import-status" role="status" hidden></p>
        <details className="setting-help columns-import-help">
          <summary>Import format</summary>
          <p>CSV, one row per wallet: <code>column,sol,sell</code>. A column's first row is its LaunchSeeds signer; its sell rule is the first one
            given (<code>profit 2</code>, <code>time 30</code>, <code>floor 30k</code> or <code>immediate</code>). Add <code>proceeds,&lt;address&gt;</code> for the proceeds wallet.</p>
          <p>Tranches, one row per wallet: <code>t1,sol,trigger,sell</code>; the trigger is <code>after 10s</code>, <code>mcap 50k</code> or
            {" "}<code>mcap below 20k within 60m</code>. A tranche can also sell with <code>ladder 25k</code>: one wallet at a time.</p>
          <pre className="mono">{"column,sol,sell\n1,0.2,profit 2\n1,0.1\n2,0.15,time 30\nt1,0.1,after 10s,profit 10\nt1,0.1\nt2,0.2,mcap 50k,time 60\nproceeds,<your address>"}</pre>
          <p>JSON, the same as Export JSON: <code>{'{"proceedsWallet":"…","columns":[{"slots":[0.2,0.1],"sell":"profit 2"}],"tranches":[{"slots":[0.1],"trigger":"after 10s","sell":"profit 10"}]}'}</code></p>
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
        <p className="setting-help">
          A market cap floor only holds a sale back: the sale's SOL minimum makes it fail on chain if it would end below the floor, and
          the wallets wait for a sale that clears. Nothing buys to defend the level, and anyone else can still sell below it. A low floor
          can sell at a loss. A high one may never clear, and the wallets keep holding.
        </p>
        <p className="setting-help">
          Tranches buy after the launch, one transaction each, paid from the deposit address, which keeps their SOL until then. A market-cap
          tranche that does not trigger within its window is skipped, and its SOL stays in the deposit address. Fresh wallets are reused
          from finished launches when free.
        </p>
      </div>
    </section>
  );
}
