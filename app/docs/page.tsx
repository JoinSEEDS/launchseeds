import { SiteNav } from "../components/site-nav";

const SECTIONS = [
  ["overview", "What LaunchSeeds is"],
  ["how", "Three parts, one loop"],
  ["launch", "Launching a token"],
  ["challenges", "Posting a challenge"],
  ["treasury", "Fees and the treasury"],
  ["submit", "Completing a challenge"],
  ["review", "Reviewing and paying"],
  ["why", "Toward regenerative token economies"],
  ["faq", "Common questions"],
] as const;

export default function DocsPage() {
  return (
    <>
      <header className="sky-short">
        <SiteNav current="docs" />
        <div className="docs-hero container">
          <span className="eyebrow">Documentation</span>
          <h1>How LaunchSeeds turns trading into <em>real-world action</em></h1>
          <p>Launching a token free, funding its challenges from trading fees, and paying the people who complete them.</p>
        </div>
      </header>
      <div className="docs-layout container">
        <nav className="toc" aria-label="On this page">
          <span className="eyebrow">On this page</span>
          <ul id="toc">{SECTIONS.map(([id, title]) => <li><a href={`#${id}`}>{title}</a></li>)}</ul>
        </nav>
        <main className="docs-main">
          <section id="overview" className="doc-sec" aria-labelledby="overview-h">
            <span className="eyebrow">Overview</span>
            <h2 id="overview-h">What LaunchSeeds is</h2>
            <p>LaunchSeeds is a token launchpad where trading helps fund meaningful action. A token’s creator posts <b>challenges</b>: things to do, with a reward for each completion.</p>
            <p>Every trade pays a creator fee. Those fees collect in the treasury and pay the people who complete the token’s challenges.</p>
            <div className="callout green"><b>The short version</b><span>A token community can organise around a shared objective and pay the people who do the work.</span></div>
          </section>

          <section id="how" className="doc-sec" aria-labelledby="how-h">
            <span className="eyebrow">How it works</span>
            <h2 id="how-h">Three parts, one loop</h2>
            <div className="step-cards">
              <div><span className="num-badge n1" aria-hidden="true">1</span><b>Launch free</b><span>The treasury buys your token at launch and sells right after.</span></div>
              <div><span className="num-badge n2" aria-hidden="true">2</span><b>Post challenges</b><span>Say what counts as done, the reward range and how many winners.</span></div>
              <div><span className="num-badge n3" aria-hidden="true">3</span><b>Pay who does it</b><span>The token’s fees pay each completion you approve.</span></div>
            </div>
            <p>As long as the token trades, fees keep coming in, and the creator can keep posting challenges.</p>
          </section>

          <section id="launch" className="doc-sec" aria-labelledby="launch-h">
            <span className="eyebrow">For creators</span>
            <h2 id="launch-h">Launching a token</h2>
            <p>Give the token a name, ticker, image and description, and sign with your wallet. Launching is free.</p>
            <ul>
              <li><b>Launch time</b>: about two minutes after you sign.</li>
              <li><b>Launch buy</b>: the treasury buys in four wallets, up to 3 SOL in all.</li>
              <li><b>Sells</b>: the four wallets sell 0, 3, 5 and 10 seconds after their buys are final.</li>
              <li><b>Fees</b>: the token’s creator fee goes to the treasury.</li>
              <li><b>Limit</b>: one launch per wallet a day.</li>
            </ul>
            <h3>Launch statuses</h3>
            <div className="table-wrap"><table><thead><tr><th scope="col">Status</th><th scope="col">What it means</th></tr></thead><tbody>
              <tr><td>Scheduled</td><td>The launch time is set.</td></tr>
              <tr><td>Launching</td><td>The launch is being sent.</td></tr>
              <tr><td>Live</td><td>The token is trading and its fees are collecting.</td></tr>
              <tr><td>In review</td><td>The launch did not land and is being checked.</td></tr>
            </tbody></table></div>
          </section>

          <section id="challenges" className="doc-sec" aria-labelledby="challenges-h">
            <span className="eyebrow">Challenges</span>
            <h2 id="challenges-h">Posting a challenge</h2>
            <p>Only the wallet that launched the token can post its challenges. A token can have several open at once.</p>
            <h3>Every challenge has</h3>
            <ul>
              <li><b>A title</b>: one sentence a stranger can understand.</li>
              <li><b>What counts as done</b>: the proof to submit, such as photos, a post or a merged pull request.</li>
              <li><b>Reward range</b>: the least and most one completion can earn, for example 0.10–0.50 SOL.</li>
              <li><b>Winners</b>: how many completions it pays for.</li>
            </ul>
            <p>Posting sets aside the most the challenge can pay, its top reward times its winners, from the token’s free fees. Closing it releases what was not paid.</p>
            <h3>Example challenges</h3>
            <div className="table-wrap"><table><thead><tr><th scope="col">Type</th><th scope="col">Example</th><th scope="col">What counts as proof</th></tr></thead><tbody>
              <tr><td>Local action</td><td>Clean up a park, beach or street</td><td>Before and after photos, location and date</td></tr>
              <tr><td>Open source</td><td>Fix an issue in a public repository</td><td>Link to the merged pull request</td></tr>
              <tr><td>Education</td><td>Write a beginner guide or record a lesson</td><td>Link to the published resource</td></tr>
              <tr><td>Ecosystem</td><td>Plant native trees or restore a habitat</td><td>Photos, location and a short description</td></tr>
            </tbody></table></div>
            <div className="callout lav"><b>Tip</b><span>Small, specific and checkable challenges get more completions and are easier to review fairly.</span></div>
          </section>

          <section id="treasury" className="doc-sec" aria-labelledby="treasury-h">
            <span className="eyebrow">Treasury</span>
            <h2 id="treasury-h">Fees and the treasury</h2>
            <p>Every token’s creator fee goes to one LaunchSeeds treasury wallet. Each token’s share is counted from its own trades, and only pays that token’s challenges.</p>
            <div className="table-wrap"><table><thead><tr><th scope="col">Item</th><th scope="col">Value</th></tr></thead><tbody>
              <tr><td>Fee to the treasury</td><td>The creator fee on every trade</td></tr>
              <tr><td>Treasury wallet</td><td>Shown on each token page</td></tr>
              <tr><td>Who pays</td><td>The treasury, as soon as the creator approves</td></tr>
              <tr><td>Left over when a challenge closes</td><td>Stays with the token for its next challenge</td></tr>
            </tbody></table></div>
          </section>

          <section id="submit" className="doc-sec" aria-labelledby="submit-h">
            <span className="eyebrow">For participants</span>
            <h2 id="submit-h">Completing a challenge</h2>
            <ol>
              <li>Open a token page and read its challenges.</li>
              <li>Do the task.</li>
              <li>Submit a link to your proof and a short note on what you did.</li>
              <li>Use the slider to choose what you think your work deserves within the range. This is your <b>ask</b>.</li>
              <li>Sign with your wallet. That wallet is the one paid.</li>
              <li>The creator sets the final payout within the range. The token page shows it next to your ask, with a link to the transaction.</li>
            </ol>
            <p>One submission per wallet per challenge. If it is rejected, you can submit again.</p>
          </section>

          <section id="review" className="doc-sec" aria-labelledby="review-h">
            <span className="eyebrow">For creators</span>
            <h2 id="review-h">Reviewing and paying</h2>
            <p>Connect the wallet that launched the token to review submissions on its page.</p>
            <div className="table-wrap"><table><thead><tr><th scope="col">Action</th><th scope="col">What happens</th></tr></thead><tbody>
              <tr><td>Approve &amp; pay</td><td>Set the amount within the range; it starts at the ask. The treasury sends it within a minute, and the task shows both numbers and its transaction.</td></tr>
              <tr><td>Reject</td><td>The task moves to Rejected with its ask still visible. Nothing is paid.</td></tr>
            </tbody></table></div>
            <div className="callout lav"><b>Ask vs paid</b><span>Every task keeps two public numbers: what was asked and what was paid. Paying below the ask is allowed, and everyone can see the gap.</span></div>
          </section>

          <section id="why" className="doc-sec" aria-labelledby="why-h">
            <span className="eyebrow">Why it matters</span>
            <h2 id="why-h">Toward regenerative token economies</h2>
            <p>Most launchpads focus on making it easier to create and trade tokens. LaunchSeeds asks a different question: what happens when the value generated by trading is redirected toward people creating value?</p>
            <p>For years, SEEDS has explored what an economic system would look like if it rewarded regeneration rather than extraction. LaunchSeeds brings that philosophy to token launches: decentralised markets funding collaboration, useful contributions and regenerative action.</p>
            <div className="callout green"><b>Our belief</b><span>The next generation of token economies should reward not only those who hold or trade, but also those who contribute.</span></div>
          </section>

          <section id="faq" className="doc-sec" aria-labelledby="faq-h">
            <span className="eyebrow">FAQ</span>
            <h2 id="faq-h">Common questions</h2>
            <div className="faq-item"><h3>Does every token need a challenge?</h3><p>No. Its fees collect until its creator posts one.</p></div>
            <div className="faq-item"><h3>Who decides whether a task is complete?</h3><p>The token’s creator approves or rejects each submission, publicly.</p></div>
            <div className="faq-item"><h3>Why can a payout differ from the ask?</h3><p>The ask is the participant’s view of what their work deserves. The creator decides the final amount within the range. Both stay public.</p></div>
            <div className="faq-item"><h3>Can a challenge be changed after it starts?</h3><p>No. The creator can close it and post a new one.</p></div>
            <div className="faq-item"><h3>What chain is LaunchSeeds on?</h3><p>Solana. Rewards are paid in SOL.</p></div>
          </section>

          <div className="cta-card">
            <div><b>Launch something that matters</b><span>Launch a token. Post challenges. Reward the people who do them.</span></div>
            <a className="btn btn-primary" href="/launch" style={{ minHeight: "50px", padding: "0 24px", fontSize: "16px" }}>Launch a token</a>
          </div>
        </main>
      </div>
    </>
  );
}
