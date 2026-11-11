import { getStore } from "../../src/server/runtime";
import { SiteNav } from "../components/site-nav";
import { sol, solRange } from "../components/token-cards";

/** Every open challenge on every live coin, newest first. */
export default function ChallengesPage() {
  const store = getStore(), c = store.repo.challenges;
  const cards = c.openChallenges().flatMap((ch) => {
    const token = store.repo.tokens.get(ch.tokenId);
    if (!token?.mint || token.status !== "live") return [];
    const subs = c.submissionsByChallenge(ch.id);
    const paid = subs.filter((s) => s.status === "paid").length, taken = subs.filter((s) => !["pending", "rejected"].includes(s.status)).length;
    return [{ ch, token, paid, taken, waiting: subs.filter((s) => s.status === "pending").length, available: c.balance(token.id).available }];
  });
  return (
    <>
      <header className="sky-short">
        <SiteNav current="challenges" />
        <div className="docs-hero container">
          <span className="eyebrow">Challenges</span>
          <h1>Do the work, <em>get paid</em></h1>
          <p>Every open challenge. Pick one, do it, and submit proof on its coin’s page.</p>
        </div>
      </header>
      <main className="launches container" style={{ paddingTop: "32px" }}>
        <div className="grid-cards">
          {cards.length ? cards.map(({ ch, token, paid, taken, waiting, available }) => (
            <article className="card token-card" key={ch.id}>
              <div className="body">
                <a className="title-row" href={`/coin/${encodeURIComponent(token.mint!)}`} style={{ alignItems: "center", gap: "12px" }}>
                  {token.image ? <img src={token.image} alt="" width={44} height={44} style={{ borderRadius: "12px", objectFit: "cover" }} /> : null}
                  <h3>${token.symbol}</h3><span>{token.name}</span>
                </a>
                <div className="challenge-box">
                  <div className="top">
                    <svg className="icon" style={{ color: "var(--green)" }}><use href="#i-leaf" /></svg>
                    <span className="label">{taken >= ch.maxWinners ? "All winners chosen" : "Open"}</span>
                    <span className="reward">{solRange(ch.minRewardLamports, ch.maxRewardLamports)} SOL / task</span>
                  </div>
                  <span className="name">{ch.title}</span>
                  {ch.description ? <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--body)" }}>{ch.description.length > 180 ? `${ch.description.slice(0, 180)}…` : ch.description}</p> : null}
                  <div className="progress" role="progressbar" aria-label="Completions paid" aria-valuemin={0} aria-valuemax={ch.maxWinners} aria-valuenow={paid}><span style={{ width: `${Math.min(100, Math.round((paid / ch.maxWinners) * 100))}%` }}></span></div>
                  <div className="meta"><span><b>{paid} / {ch.maxWinners}</b> paid · {waiting} waiting</span><span>Treasury <b>{sol(available)} SOL</b></span></div>
                </div>
                <a className="btn btn-soft" href={`/coin/${encodeURIComponent(token.mint!)}`}>Take part <svg style={{ width: "14px", height: "14px" }}><use href="#i-arrow" /></svg></a>
              </div>
            </article>
          )) : <div className="empty" style={{ gridColumn: "1/-1" }}>No open challenges yet. <a href="/launch">Launch a token</a> and post one.</div>}
        </div>
      </main>
    </>
  );
}
