import { getStore } from "../src/server/runtime";
import { launchCatalog, catalogOverview, readCatalogInput, type CatalogInput } from "../src/server/launch-catalog";
import { currentRequestUrl } from "../src/server/site-brand";
import { catalogHref, type CatalogFilter } from "../lib/catalog-pagination";
import { CatalogNavigation } from "./components/catalog-navigation";
import { TokenCards } from "./components/token-cards";
import { SiteNav } from "./components/site-nav";

export default function HomePage() {
  return renderHomePage(getStore(), readCatalogInput(new URL(currentRequestUrl() ?? "http://localhost/").searchParams));
}
export function renderHomePage(store: ReturnType<typeof getStore>, input?: CatalogInput) {
  const page = launchCatalog(store, input), overview = catalogOverview(store), cards = page.items;
  return (
    <>
      <header>
        <div className="sky">
          <SiteNav current="home" />
          <div className="hero">
            <div className="hero-tag"><svg className="icon" style={{ width: "14px", height: "14px" }}><use href="#i-leaf" /></svg>Launch tokens with challenges</div>
            <h1>Trading that rewards<br /><em>real-world action.</em></h1>
            <p className="hero-sub">Launch a coin. Its trading fees pay the people who complete its challenges.</p>
            <div className="hero-ctas">
              <a className="btn btn-primary btn-lg" href="/launch">Launch a token <svg><use href="#i-arrow" /></svg></a>
              <a className="btn btn-white btn-lg" href="/challenges" style={{ fontWeight: 600 }}>Find a challenge</a>
            </div>
            <p className="hero-stats"><b>{overview.live}</b> live tokens · <b>{overview.scheduled}</b> launching</p>
          </div>
        </div>
        <div className="hills"><img src="/hills.jpg" alt="" /></div>
      </header>
      <main>
        <section className="how container" aria-labelledby="how-h">
          <div className="card">
            <div className="how-head">
              <div>
                <span className="eyebrow lav">How it works</span>
                <h2 id="how-h">Fees fund the work, not just the hype.</h2>
              </div>
              <a className="btn btn-outline" href="/docs">Read the docs</a>
            </div>
            <ol className="steps">
              <li><span className="num-badge n1" aria-hidden="true">1</span><h3>Launch</h3><p>Name your coin and sign with your wallet. The treasury buys it at launch and sells right after.</p></li>
              <li><span className="num-badge n2" aria-hidden="true">2</span><h3>Post challenges</h3><p>Say what counts as done, the pay range and how many winners.</p></li>
              <li><span className="num-badge n3" aria-hidden="true">3</span><h3>Pay who does it</h3><p>The coin’s trading fees pay each completion you approve, on-chain.</p></li>
            </ol>
          </div>
        </section>

        <section id="launches" className="launches container" aria-labelledby="launches-h">
          <div className="launches-head">
            <div>
              <h2 id="launches-h">Launches &amp; challenges</h2>
              <p>Every challenge, treasury and payout is public.</p>
            </div>
            <div className="toolbar">
              <div className="segmented" role="tablist" aria-label="Filter launches">
                {([["All", "all"], ["Launching", "scheduled"], ["Live", "live"]] as const).map(([label, filter]) => (
                  <a href={catalogHref({ filter: filter as CatalogFilter, q: page.q })} role="tab" data-card-filter={filter} aria-selected={String(filter === page.filter)}>{label}</a>
                ))}
              </div>
              <form className="search" role="search" action="/" method="get">
                <svg className="icon" style={{ color: "#5B665E" }}><use href="#i-search" /></svg>
                <input type="hidden" name="filter" value={page.filter} />
                <label htmlFor="q" className="sr-only">Search name or ticker</label>
                <input id="q" type="search" data-card-search="" name="q" value={page.q} maxLength={80} placeholder="Search name or ticker" autoComplete="off" />
                <button className="btn btn-dark" type="submit" style={{ fontSize: "14px" }}>Search</button>
              </form>
            </div>
          </div>
          <div className="grid-cards" id="token-cards" aria-live="polite" data-page={JSON.stringify(page)}>
            <TokenCards items={cards} />
          </div>
          <p className="catalog-status" id="catalog-status" role="status">{page.total} launches</p>
          <nav className="catalog-pages" id="catalog-pagination" aria-label="Launch pages"><CatalogNavigation page={page} /></nav>
        </section>
      </main>
    </>
  );
}
