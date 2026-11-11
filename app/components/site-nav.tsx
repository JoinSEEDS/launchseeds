import { SITE_NAME } from "../../lib/site-brand";

/** The top navigation every page draws inside its own header. */
export function SiteNav({ current }: { current?: "home" | "docs" | "launch" | "seeds" | "challenges" }) {
  return (
    <nav className="nav container" aria-label="Primary">
      <a className="brand" href="/"><img src="/logo.png" alt="" width="40" height="40" /><span>{SITE_NAME}</span></a>
      <div className="nav-links">
        <a href="/" aria-current={current === "home" ? "page" : undefined}>Launchpad</a>
        <a href="/challenges" aria-current={current === "challenges" ? "page" : undefined}>Challenges</a>
        <a href="/seeds" aria-current={current === "seeds" ? "page" : undefined}>$SEEDS</a>
        <a href="/docs" aria-current={current === "docs" ? "page" : undefined}>Docs</a>
      </div>
      <div className="nav-actions">
        <button className="btn btn-glass" type="button" data-wallet-btn>Connect wallet</button>
        {current === "launch" ? null : <a className="btn btn-primary" href="/launch">Launch a token</a>}
      </div>
    </nav>
  );
}
