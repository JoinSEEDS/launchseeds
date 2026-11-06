import { currentBrand } from "../src/server/site-brand";

export default function RootLayout({ children }: { children: any }) {
  const brand = currentBrand();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#090e15" />
        {brand.kind === "launchseeds" ? (
          <>
            <link rel="icon" type="image/png" href="/launchseeds-icon.png?v=2" />
            <link rel="apple-touch-icon" href="/launchseeds-icon.png?size=180&v=2" />
          </>
        ) : (
          <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=1" />
        )}
        <title>{brand.name}</title>
        <meta
          name="description"
          content={`${brand.name} · Scheduled launches with public execution rules`}
        />
      </head>
      <body>
        <svg
          width="0"
          height="0"
          style={{ position: "absolute" }}
          aria-hidden="true"
        >
          <symbol id="i-pack" viewBox="0 0 24 24">
            <rect x="6" y="3" width="12" height="18" rx="2" />
            <path d="M6 7.5h12M6 16.5h12" />
          </symbol>
          <symbol id="i-stock" viewBox="0 0 24 24">
            <path d="M4 19h16M5 15l4-4 3 3 7-7M15 7h4v4" />
          </symbol>
          <symbol id="i-burn" viewBox="0 0 24 24">
            <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.8 2.5-5 .3 1.6 1 2.6 2 3 0-3-.5-5.5.5-8z" />
          </symbol>
          <symbol id="i-x" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" />
            <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
          </symbol>
          <symbol id="i-github" viewBox="0 0 24 24">
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="8" r="2" />
            <path d="M6 7v10M18 10c0 4-6 3-12 7" />
          </symbol>
          <symbol id="i-wallet" viewBox="0 0 24 24">
            <path d="M4 7a2 2 0 0 1 2-2h11v4" />
            <rect x="3" y="9" width="18" height="11" rx="2" />
            <path d="M16 14.5h2" />
          </symbol>
        </svg>
        <div className="wrap">
          <header className="topbar">
            <a className="brand" href="/">
              {brand.kind === "launchseeds" ? <img className="brand__logo" src="/launchseeds-icon.png?size=256&v=2" alt="" width={28} height={28} /> : null}
              {brand.name.toUpperCase()}
            </a>
            {brand.kind === "launchseeds" ? <span className="addr" style={{marginLeft:"auto",minWidth:0,overflowWrap:"anywhere"}}><b>CA:</b>{brand.ca ? <a className="mono" href={`https://solscan.io/token/${brand.ca}`}>{brand.ca}</a> : <span>Not configured</span>}</span> : <>
            <nav className="nav" aria-label="Main">
              <a href="/">Launchpad</a>
              <a href="/token">$TOKEN</a>
              <a href="/agents">Agents</a>
              <a href="/wallet">Verify</a>
            </nav>
            <div className="topbar__actions">
              <button className="btn btn--wallet" type="button" data-wallet-btn>
                Connect Wallet
              </button>
              <a className="btn btn--primary topbar__launch" href="/launch">
                Schedule Launch
              </a>
            </div>
            </>}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
