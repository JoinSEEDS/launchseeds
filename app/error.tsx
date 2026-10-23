/** Safe, server-rendered fallback. Never show internal stacks to a visitor. */
export default function ErrorPage({ pathname }: { pathname?: string }) {
  return (
    <main className="page">
      <h1 className="page-title">Unable to load this page</h1>
      <p className="page-lede">
        The LaunchSeeds application encountered an error while rendering this
        request.
      </p>
      <div>
        <a className="btn btn--primary" href="/">
          Return to launchpad
        </a>
        {pathname && pathname !== "/" ? (
          <a className="btn" style={{ marginLeft: "8px" }} href={pathname}>
            Try again
          </a>
        ) : null}
      </div>
    </main>
  );
}
