import { getStore } from "../src/server/runtime";
import { launchCatalog, catalogOverview, readCatalogInput, type CatalogInput } from "../src/server/launch-catalog";
import { currentRequestUrl } from "../src/server/site-brand";
import { catalogHref, type CatalogFilter } from "../lib/catalog-pagination";
import { CatalogNavigation } from "./components/catalog-navigation";
import { TokenCards } from "./components/token-cards";
export default function HomePage() {
  return renderHomePage(getStore(),readCatalogInput(new URL(currentRequestUrl() ?? "http://localhost/").searchParams));
}
export function renderHomePage(store: ReturnType<typeof getStore>, input?: CatalogInput) {
  const page=launchCatalog(store,input), overview=catalogOverview(store), cards=page.items, next=overview.next;
  return (
    <main className="page launchpad-page">
      <section className="launchpad-hero">
        <div>
          <span className="eyebrow">PUBLIC PLANS. VISIBLE EXECUTION.</span>
          <h1>
            Know the plan.
            <br />
            <span>Before the launch.</span>
          </h1>
          <p>
            Scheduled launches whose buy wallets and sell rules are published
            before the coin exists.
          </p>
          <a className="btn btn--primary" href="/launch">
            Schedule a launch <span aria-hidden="true">&#8599;</span>
          </a>
        </div>
        <aside className="hero-next">
          <span className="label">Upcoming funded launch</span>
          {next ? (
            <>
              <h2>${next.symbol}</h2>
              <time>
                {new Date(next.scheduledAt)
                  .toISOString()
                  .replace("T", " ")
                  .replace(".000Z", " UTC")}
              </time>
              <a href={`/coin/${next.mint ?? next.planHash}`}>
                Inspect the plan &#8594;
              </a>
            </>
          ) : (
            <>
              <h2>
                The next slot
                <br />
                is yours.
              </h2>
              <p>
                Choose the time. Publish the allocation. Follow every
                transaction.
              </p>
            </>
          )}
          <dl>
            <div>
              <dt>Live tokens</dt>
              <dd>{overview.live}</dd>
            </div>
            <div>
              <dt>Scheduled plans</dt>
              <dd>{overview.scheduled}</dd>
            </div>
          </dl>
        </aside>
      </section>
      <section className="launchpad-catalog" aria-labelledby="tokens-title">
        <div className="launchpad-toolbar">
          <h2 id="tokens-title">Launches</h2>
          <div className="tabs" role="tablist" aria-label="Launch filters">
            {["All", "Scheduled", "Live"].map((label, i) => (
              <a
                href={catalogHref({filter:label.toLowerCase() as CatalogFilter,q:page.q})}
                className="tab"
                role="tab"
                data-card-filter={label.toLowerCase()}
                aria-selected={String(label.toLowerCase() === page.filter)}
              >
                {label}
              </a>
            ))}
          </div>
          <form className="search" action="/" method="get"><input type="hidden" name="filter" value={page.filter} /><label>
            <span className="sr-only">Search tokens</span>
            <input
              className="input"
              data-card-search="" name="q" value={page.q} maxLength={80}
              placeholder="Search name or ticker"
            />
          </label><button className="btn btn--ghost" type="submit">Search</button></form>
        </div>
        <div
          className="launch-card-grid"
          id="token-cards"
          data-cards={JSON.stringify(cards)} data-page={JSON.stringify(page)}
        >
          <TokenCards items={cards} />
        </div>
        <p id="catalog-status" role="status">{page.total} launches</p>
        <nav id="catalog-pagination" aria-label="Launch pages"><CatalogNavigation page={page} /></nav>
      </section>
      <section className="launchpad-principles">
        <div>
          <b>01 / Set the time</b>
          <p>Fund the launch before its published schedule.</p>
        </div>
        <div>
          <b>02 / Publish the plan</b>
          <p>Three wallets. An exact allocation. A fixed sell target.</p>
        </div>
        <div>
          <b>03 / Follow the money</b>
          <p>Inspect buys, sales and profit receipts on each token's page.</p>
        </div>
      </section>
    </main>
  );
}
