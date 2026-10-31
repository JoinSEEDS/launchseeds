/** Admin-only panel (lib/admin-finalize.ts shows it to an admin wallet, or with
 * ?admin): finalize the coin, selling whatever still holds at market. */
export function AdminFinalize({ mint, admins }: { mint: string; admins: string[] }) {
  if (!admins.length) return null;
  return (
    <section className="panel" id="admin-finalize" data-mint={mint} data-admins={admins.join(",")} hidden>
      <div className="panel__head"><span className="label">Admin</span></div>
      <div className="panel__body stack">
        <p className="setting-help">
          Finalize sells every column and bundle on this coin that is still holding, at market now, whatever its sell rule,
          and resumes any that are stuck. The SOL goes where the launch published: the proceeds wallet, or the bundle's settlement.
        </p>
        <p className="setting-help">
          Liquidate everything also sells every token of this coin left in any wallet the launch used (signers and fresh wallets,
          including their own trades) and closes those token accounts; that SOL stays in each wallet. The deployer is also emptied
          to the proceeds wallet.
        </p>
        <div className="btn-row">
          <button className="btn btn--sm" type="button" id="admin-connect" hidden>Connect admin wallet</button>
          <button className="btn btn--sm btn--danger" type="button" id="admin-finalize-button" data-action="finalize" hidden>Finalize coin</button>
          <button className="btn btn--sm btn--danger" type="button" id="admin-liquidate-button" data-action="liquidate" hidden>Liquidate everything</button>
        </div>
        <p className="opt-note" id="admin-finalize-message" role="status" hidden></p>
      </div>
    </section>
  );
}
