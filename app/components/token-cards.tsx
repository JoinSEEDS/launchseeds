export type CardChallenge = { title: string; minRewardLamports: string; maxRewardLamports: string; maxWinners: number; paid: number; waiting: number; more: number };
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
  /** Live coins only: the newest open challenge and the coin's fee money. */
  challenge?: CardChallenge | null;
  earnedLamports?: string;
  availableLamports?: string;
};

export const sol = (lamports: string | number | bigint) => (Number(lamports) / 1e9).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
export const solRange = (min: string, max: string) => (min === max ? sol(min) : `${sol(min)}–${sol(max)}`);
export const utc = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");

const STATUS: Record<string, string> = { live: "Live", scheduled: "Scheduled", launching: "Launching", delayed: "Launching", awaiting_payment: "Scheduled", missed: "Missed", review: "In review", needs_review: "In review" };
export function StatusChip({ status }: { status: string }) {
  if (status === "live") return <span className="chip chip-live"><span className="dot"></span>Live</span>;
  if (status === "missed" || status === "review" || status === "needs_review") return <span className="chip chip-review"><span className="dot"></span>{STATUS[status]}</span>;
  return <span className="chip chip-outline">{STATUS[status] ?? "Scheduled"}</span>;
}

function ChallengeBox({ c, available }: { c: CardChallenge; available: string }) {
  const pct = Math.min(100, Math.round((c.paid / c.maxWinners) * 100));
  return (
    <div className="challenge-box">
      <div className="top">
        <svg className="icon" style={{ color: "var(--green)" }}><use href="#i-leaf" /></svg>
        <span className="label">{c.more ? `Active challenge · ${c.more + 1} open` : "Active challenge"}</span>
        <span className="reward">{solRange(c.minRewardLamports, c.maxRewardLamports)} SOL / task</span>
      </div>
      <span className="name">{c.title}</span>
      <div className="progress" role="progressbar" aria-label="Completions paid" aria-valuemin={0} aria-valuemax={c.maxWinners} aria-valuenow={c.paid}><span style={{ width: `${pct}%` }}></span></div>
      <div className="meta"><span><b>{c.paid} / {c.maxWinners}</b> paid · {c.waiting} waiting</span><span>Treasury <b>{sol(available)} SOL</b></span></div>
    </div>
  );
}

export function TokenCards({ items }: { items: TokenCardData[] }) {
  if (!items.length) return <div className="empty" style={{ gridColumn: "1/-1" }}>No launches match that search.</div>;
  return (
    <>
      {items.map((c) => {
        const live = c.status === "live";
        return (
          <article className="card token-card" key={c.key}>
            <a className="art" href={c.href} aria-label={`View ${c.name}`}>
              {c.image ? <img src={c.image} alt="" loading="lazy" /> : null}
              <StatusChip status={c.status} />
            </a>
            <div className="body">
              <div>
                <div className="title-row"><h3>${c.symbol}</h3><span>{c.name}</span></div>
                {c.mint ? <div className="ca" title={c.mint}>{c.mint}</div> : null}
              </div>
              {live ? (
                c.challenge ? <ChallengeBox c={c.challenge} available={c.availableLamports ?? "0"} /> : (
                  <div className="challenge-empty"><span className="label">No challenge yet</span><p>Fees collect for this coin until its creator posts one.</p></div>
                )
              ) : null}
              {c.scheduledAt ? (
                <div className="sched">
                  <svg className="icon" style={{ color: "var(--lav-ink-2)" }}><use href="#i-clock" /></svg>
                  <span className="k">{live ? "Launched" : "Launch"}</span>
                  <time className="v" dateTime={new Date(c.scheduledAt).toISOString()}>{utc(c.scheduledAt)} UTC</time>
                </div>
              ) : null}
              {live ? (
                <dl className="facts">
                  <div><dt>Market cap</dt><dd className={c.marketCap ? "" : "unset"}>{c.marketCap ?? "Not observed"}</dd></div>
                  <div><dt>Fees earned</dt><dd>{sol(c.earnedLamports ?? "0")} SOL</dd></div>
                </dl>
              ) : null}
              <a className="btn btn-soft" href={c.href}>{live ? "View coin & challenges" : "View launch"} <svg style={{ width: "14px", height: "14px" }}><use href="#i-arrow" /></svg></a>
            </div>
          </article>
        );
      })}
    </>
  );
}
