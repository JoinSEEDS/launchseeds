import { SiteNav } from "./components/site-nav";

/** Safe, server-rendered fallback. Never show internal stacks to a visitor. */
export default function ErrorPage({ pathname }: { pathname?: string }) {
  return (
    <>
      <header className="sky-short"><SiteNav /></header>
      <main className="token-layout container">
        <div className="empty">
          <p>This page could not load.</p>
          <p style={{ marginTop: "16px", display: "flex", gap: "8px", justifyContent: "center" }}>
            <a className="btn btn-primary" href="/">Back to the launchpad</a>
            {pathname && pathname !== "/" ? <a className="btn btn-white" href={pathname}>Try again</a> : null}
          </p>
        </div>
      </main>
    </>
  );
}
