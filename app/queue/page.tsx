import { getStore } from "../../src/server/runtime";
import { queueList } from "../../src/server/launch-queue";
import { SiteNav } from "../components/site-nav";

/** The launch line: every coin waiting to launch, each with its own launch time.
 * Filled and kept fresh by page.client.tsx. */
export default function QueuePage() {
  const list = queueList(getStore());
  return (
    <>
      <header className="sky-short">
        <SiteNav />
        <div className="docs-hero container">
          <span className="eyebrow">Launch queue</span>
          <h1>Coins <em>launching next</em></h1>
          <p>Each coin has its own launch time, one after another.</p>
        </div>
      </header>
      <main className="container launch-main" id="queue-root" data-queue={JSON.stringify(list)}>
        <section className="card panel">
          <div className="task-list" data-queue-list>
            {list.waiting.length ? null : <div className="empty">No coins waiting.</div>}
          </div>
        </section>
      </main>
    </>
  );
}
