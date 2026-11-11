export type TokenCardData = {
  key: string;
  mint?: string | null;
  name: string;
  symbol: string;
  image: string;
  href: string;
  status: string;
  scheduledAt: number | null;
  createdAt: number;
  marketCap: string | null;
  target: number | null;
  profit: string | null;
  destination: string | null;
};
export function TokenCards({ items }: { items: TokenCardData[] }) {
  return (
    <>
      {items.length ? (
        items.map((c) => (
          <article className="launch-card" key={c.key}>
            <a
              className="launch-card__art"
              href={c.href}
              aria-label={`View ${c.name}`}
            >
              {c.image ? (
                <img src={c.image} alt="" loading="lazy" />
              ) : (
                <span>{c.symbol.slice(0, 2)}</span>
              )}
              <span
                className={`pill launch-card__status ${c.status === "live" ? "pill--active" : ""}`}
              >
                {c.status.replaceAll("_", " ")}
              </span>
            </a>
            <div className="launch-card__body">
              <a className="launch-card__title" href={c.href}>
                <strong>${c.symbol}</strong>
                <span>{c.name}</span>
              </a>
              {c.mint ? <p className="mono" style={{overflowWrap:"anywhere",fontSize:"11px"}}>CA: {c.mint}</p> : null}
              {c.scheduledAt ? (
                <div className="card-schedule">
                  <span className="label label--sm">Launch (UTC)</span>
                  <time dateTime={new Date(c.scheduledAt).toISOString()}>
                    {new Date(c.scheduledAt)
                      .toISOString()
                      .replace("T", " ")
                      .replace(".000Z", " UTC")}
                  </time>
                </div>
              ) : null}
              <dl className="card-metrics">
                <div>
                  <dt>Market cap</dt>
                  <dd>{c.marketCap ?? "Not observed"}</dd>
                </div>
                <div>
                </div>
                <div>
                  <dt>Sell target</dt>
                  <dd>{c.target ? `+${c.target - 100}%` : "Not configured"}</dd>
                </div>
                <div>
                  <dt>Realized profit</dt>
                  <dd>
                    {c.profit === null ? "Not realized" : `${c.profit} SOL`}
                  </dd>
                </div>
              </dl>
              {c.destination ? (
                <p className="card-destination">
                  Profits <b>{c.destination}</b>
                </p>
              ) : null}
              <a className="btn btn--block" href={c.href}>
                {c.scheduledAt ? "View launch plan" : "View token"}
              </a>
            </div>
          </article>
        ))
      ) : (
        <div className="panel panel__body launch-empty">
          <h2>No matching launches</h2>
          <p>No live tokens yet.</p>
          <a className="btn btn--primary" href="/launch">
            Launch a coin
          </a>
        </div>
      )}
    </>
  );
}
