import { shortAddress } from "../../lib/format";

export type ActivityTrade = { signature: string; at: number; side: "buy" | "sell"; sol: number; tokens: number; wallet: string };
export type ActivityHolder = { wallet: string; balance: number; gravity: number; share: number };
export type Activity = { trades: ActivityTrade[]; gravity: { total: number; holders: ActivityHolder[] } };

const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const millions = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

/** Recent trades and the gravity ranking, side by side. `labels` names the
 * launch's own wallets (e.g. "C1 ace"). */
export function CoinActivity({ activity, labels, now = Date.now() }: { activity: Activity | null; labels: Record<string, string>; now?: number }) {
  const who = (wallet: string) => (
    <a className="mono" href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener noreferrer">
      {labels[wallet] ? <span className="coin-tag">{labels[wallet]}</span> : shortAddress(wallet)}
    </a>
  );
  return (
    <div className="coin-activity">
      <section className="panel" aria-label="Trades">
        <div className="panel__head"><span className="label">Trades</span></div>
        <div className="table-wrap">
          <table className="table coin-table">
            <thead><tr><th>Age</th><th>Wallet</th><th></th><th className="num">SOL</th><th className="num">Tokens</th><th></th></tr></thead>
            <tbody>
              {!activity ? <tr><td colSpan={6} className="dim">Loading…</td></tr>
                : !activity.trades.length ? <tr><td colSpan={6} className="dim">No trades yet</td></tr>
                : activity.trades.map((t) => (
                  <tr>
                    <td className="dim">{ago(t.at, now)}</td>
                    <td>{who(t.wallet)}</td>
                    <td className={t.side === "buy" ? "up" : "down"}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                    <td className="num">{t.sol.toFixed(3)}</td>
                    <td className="num">{millions(t.tokens)}</td>
                    <td><a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noopener noreferrer" aria-label="Transaction">↗</a></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" aria-label="Gravity">
        <div className="panel__head"><span className="label">Gravity</span>{activity ? <span className="dim">{activity.gravity.holders.length} holders</span> : null}</div>
        <div className="table-wrap">
          <table className="table coin-table">
            <thead><tr><th>#</th><th>Holder</th><th className="num">Holding</th><th className="num">Share</th></tr></thead>
            <tbody>
              {!activity ? <tr><td colSpan={4} className="dim">Loading…</td></tr>
                : !activity.gravity.holders.length ? <tr><td colSpan={4} className="dim">No holders tracked yet</td></tr>
                : activity.gravity.holders.map((h, i) => (
                  <tr>
                    <td className="dim">{i + 1}</td>
                    <td>{who(h.wallet)}</td>
                    <td className="num">{millions(h.balance)}</td>
                    <td className="num">{(h.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
