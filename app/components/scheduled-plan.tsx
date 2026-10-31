import { launchCountdown } from "../../lib/launch-countdown";
import { UserBatchesPlan } from "./user-batches-plan";
import type { ScheduledLaunchView } from "../../src/server/scheduled-launches";
import { shortAddress } from "../../lib/format";
export const solAmount = (lamports: string) =>
  (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });
export function ScheduledPlan({ plan }: { plan: ScheduledLaunchView }) {
  if(plan.userBatches)return <UserBatchesPlan plan={plan}/>;
  const bundle = plan.bundle;
  return (
    <section
      className="panel scheduled-plan"
      aria-label="Published launch plan"
    >
      <div className="panel__head">
        <span className="label">Published launch plan</span>
        <span className="pill">{plan.status.replaceAll("_", " ")}</span>
      </div>
      <div className="panel__body stack">
        <p role="status" data-launch-at={String(plan.scheduledAt)} data-launch-status={plan.status}>{launchCountdown(plan.scheduledAt,plan.status)}</p>
        {plan.description ? <div><span className="label label--sm">About this project</span><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{plan.description}</p></div> : null}
        {plan.mint ? <div><span className="label label--sm">{plan.status === "live" ? "Token CA" : "Reserved CA / not launched yet"}</span><p className="mono" style={{overflowWrap:"anywhere"}}>{plan.mint}</p><button className="btn-copy" type="button" data-copy={plan.mint}>Copy CA</button></div> : null}
        <div className="plan-time">
          <span className="label label--sm">Scheduled launch (UTC)</span>
          <time dateTime={new Date(plan.scheduledAt).toISOString()}>
            {new Date(plan.scheduledAt)
              .toISOString()
              .replace("T", " ")
              .replace(".000Z", " UTC")}
          </time>
        </div>
        {plan.note ? (
          <p className="setting-help" role="status">
            {plan.note}
          </p>
        ) : null}
        <details className="execution-rules">
          <summary>Rules followed by the protection wallets</summary>
          <ol>
            <li>Creation waits for timely payment and the published launch time. The creation/funding transaction and three wallet buys are submitted in one Jito bundle.</li>
            <li>After fills confirm, one combined sale is signed and saved. Each wallet has its own published minimum return; all three sells must succeed atomically.</li>
            <li>The worker simulates that sale on its single fast loop, normally two seconds after the previous cycle finishes. RPC work and chain confirmation add time; this is not an instant exchange limit order.</li>
            <li>If the target is not reached, the wallets keep holding. No additional helper wallets buy to force the exit. Expiring unsent candidates are refreshed.</li>
            <li>After the sale confirms, empty token accounts close and SOL returns to capital. Only finalized sweep proceeds minus recorded costs fund the published profit policy. BOOST buybacks begin after that settlement.</li>
          </ol>
        </details>
        <div className="plan-wallets">
          {plan.wallets.map((w, i) => (
            <div className="plan-wallet">
              <span className="label label--sm">
                Wallet {i + 1} <b>{plan.walletSharesBps[i]! / 100}%</b>
              </span>
              <strong>{solAmount(w.budgetLamports)} SOL</strong>
              <a
                className="mono"
                href={`https://solscan.io/account/${w.wallet}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortAddress(w.wallet)}
              </a>
              <span className="dim">
                Sell minimum{" "}
                {solAmount(
                  (
                    (BigInt(w.budgetLamports) * BigInt(plan.exitPercent) +
                      99n) /
                    100n
                  ).toString(),
                )}{" "}
                SOL
              </span>
            </div>
          ))}
        </div>
        <dl className="dl">
          <dt>Total protection</dt>
          <dd>{solAmount(plan.totalLamports)} SOL</dd>
          <dt>Profit target</dt>
          <dd>+{plan.exitPercent - 100}% per wallet, before costs</dd>
          <dt>Sale execution</dt>
          <dd>
            Prepared transactions; all three wallet minimums enforced together
          </dd>
          {plan.boost ? <><dt>BOOST buyback schedule</dt><dd>Up to {plan.boost.steps} buys over {plan.boost.durationMs / 60_000} minutes after the sale. Fewer buys if the budget is small.</dd></> : null}
          <dt>Trading fees</dt>
          <dd>{plan.holderRewards ? "Paid to token holders by Pump" : <><span>Creator fees to </span><a className="mono" style={{overflowWrap:"anywhere"}} href={`https://solscan.io/account/${plan.feesTo}`}>{plan.feesTo}</a></>}</dd>
          <dt>Profit destination</dt>
          <dd>
            {plan.profitPolicy.mode === "burn" ? (
              "Buy this token and burn it"
            ) : plan.profitPolicy.mode === "token" ? (
              "Buy back for a $TOKEN holder; delivery requires owner approval"
            ) : (
              <a
                className="mono"
                href={`https://solscan.io/account/${plan.profitPolicy.wallet}`}
              >
                {shortAddress(plan.profitPolicy.wallet)}
              </a>
            )}
          </dd>
          {plan.profitPolicy.mode !== "wallet" ? (
            <>
              <dt>Buyback execution reserve</dt>
              <dd>
                0.005 SOL; buyback starts with at least 0.002 SOL remaining
              </dd>
            </>
          ) : (
            <>
              <dt>Payout fee reserve</dt>
              <dd>0.00005 SOL</dd>
            </>
          )}
          <dt>Plan hash</dt>
          <dd className="mono plan-hash">{plan.planHash}</dd>
          {bundle ? (
            <>
              <dt>Protection state</dt>
              <dd>{bundle.status}</dd>
              <dt>Realized profit</dt>
              <dd>
                {bundle.profitLamports === null
                  ? "Not realized"
                  : `${solAmount(bundle.profitLamports)} SOL`}
              </dd>
            </>
          ) : null}
        </dl>
        {bundle?.reward?.note ? (
          <p className="setting-help" role="status">
            {bundle.reward.note}
          </p>
        ) : null}
        <p className="setting-help">
          The target is a minimum sale return, not a promised profit. Fees and
          rent are deducted before profit is distributed. Chain inclusion can
          occur after the scheduled time.
        </p>
        <div className="social-row">
          {plan.launchSignature ? (
            <a href={`https://solscan.io/tx/${plan.launchSignature}`}>
              Creation transaction
            </a>
          ) : null}
          {bundle?.exitSignature ? (
            <a href={`https://solscan.io/tx/${bundle.exitSignature}`}>
              Sale transaction
            </a>
          ) : null}
          {bundle?.payouts
            .filter((p) => p.signature)
            .map((p) => (
              <a href={`https://solscan.io/tx/${p.signature}`}>Profit payout</a>
            ))}
          {bundle?.reward?.transferSignature ? (
            <a
              href={`https://solscan.io/tx/${bundle.reward.transferSignature}`}
            >
              {plan.profitPolicy.mode === "burn"
                ? "Burn receipt"
                : "Reward receipt"}
            </a>
          ) : null}
          {bundle?.reward?.buys
            .filter((b) => b.confirmed)
            .map((b) => (
              <a href={`https://solscan.io/tx/${b.signature}`}>
                Buyback {b.step + 1}
              </a>
            ))}
        </div>
      </div>
    </section>
  );
}
