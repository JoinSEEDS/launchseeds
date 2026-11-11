/** A live coin's challenges: its fund, open challenges, a submit form with an
 * amount slider, and the creator's post / approve / reject / close controls.
 * Every action is signed in the visitor's wallet. */
import bs58 from "bs58";
import { connectWallet } from "./wallet-session";
import { walletProvider } from "./wallet-provider";
import { getJson, postJson } from "./client-request";
import { challengeCloseMessage, challengePostMessage, decisionMessage, reviewMessage, submissionMessage } from "./challenge-message";
import type { ChallengeView } from "../src/server/challenge-view";

const sol = (lamports: string | bigint) => (Number(lamports) / 1e9).toLocaleString("en", { maximumFractionDigits: 4 });
const toLamports = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 1e9)) : "";
};
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
type Child = Node | string | null | undefined | false;
function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}
const STATUS: Record<string, string> = { pending: "Waiting", rejected: "Rejected", approved: "Approved", paying: "Paying", paid: "Paid", review: "Review" };

export function mountChallenges(): () => void {
  const root = document.getElementById("challenges-root");
  const mint = root?.dataset.mint;
  if (!root || !mint) return () => {};
  let view: ChallengeView | null = null, wallet = "", stopped = false;
  const message = el("p", { class: "setting-help", role: "status" });
  const say = (text: string, error = false) => { message.textContent = text; message.classList.toggle("is-error", error); };

  /** Connects the wallet first, then builds the request it signs. */
  async function act(path: string, build: () => { body: Record<string, unknown>; text: string }, done: string) {
    try {
      wallet = await connectWallet(window);
      const provider = walletProvider(window);
      if (!provider) throw new Error("Connect a supported Solana wallet.");
      const { body, text } = build();
      say("Sign in your wallet…");
      const signature = bs58.encode((await provider.signMessage(new TextEncoder().encode(text), "utf8")).signature);
      say("Saving…");
      view = await postJson<ChallengeView>(`/api/coins/${encodeURIComponent(mint!)}/${path}`, { ...body, signature });
      say(done);
      paint();
    } catch (error) {
      say(error instanceof Error ? error.message : "That didn't work.", true);
    }
  }
  const base = () => ({ wallet, mint: mint!, issuedAt: Date.now(), nonce: nonce() });

  function postForm() {
    const title = el("input", { class: "input", maxlength: "120", placeholder: "Title, e.g. Post a video about the coin" }) as HTMLInputElement;
    const description = el("textarea", { class: "input", rows: "3", maxlength: "2000", placeholder: "What counts as done" }) as HTMLTextAreaElement;
    const min = el("input", { class: "input", type: "number", min: "0.001", step: "0.001", value: "0.01", "aria-label": "Minimum pay in SOL" }) as HTMLInputElement;
    const max = el("input", { class: "input", type: "number", min: "0.001", step: "0.001", value: "0.1", "aria-label": "Maximum pay in SOL" }) as HTMLInputElement;
    const winners = el("input", { class: "input", type: "number", min: "1", max: "100", step: "1", value: "1", "aria-label": "Winners" }) as HTMLInputElement;
    const button = el("button", { class: "btn btn--primary", type: "button" }, "Post challenge");
    button.addEventListener("click", () => {
      void act("challenges", () => { const r = { ...base(), title: title.value.trim(), description: description.value.trim(), minRewardLamports: toLamports(min.value), maxRewardLamports: toLamports(max.value), maxWinners: Number(winners.value) }; return { body: { ...r, action: "post" }, text: challengePostMessage(r) }; }, "Challenge posted.");
    });
    return el("details", { class: "panel" }, el("summary", { class: "panel__head" }, el("span", { class: "label" }, "New challenge")),
      el("div", { class: "panel__body stack" }, title, description,
        el("label", { class: "field" }, el("span", { class: "label label--sm" }, "Pay per submission (SOL), from"), min),
        el("label", { class: "field" }, el("span", { class: "label label--sm" }, "to"), max),
        el("label", { class: "field" }, el("span", { class: "label label--sm" }, "Winners"), winners), button));
  }

  function submitForm(ch: ChallengeView["challenges"][number]) {
    const proof = el("input", { class: "input", placeholder: "https:// link to your proof" }) as HTMLInputElement;
    const lo = Number(ch.minRewardLamports), hi = Number(ch.maxRewardLamports);
    const ask = el("input", { type: "range", min: String(lo), max: String(hi), step: String(Math.max(1, Math.round((hi - lo) / 100)) || 1), value: String(hi), "aria-label": "How much you ask for" }) as HTMLInputElement;
    const shown = el("b", {}, `${sol(ch.maxRewardLamports)} SOL`);
    ask.addEventListener("input", () => { shown.textContent = `${sol(ask.value)} SOL`; });
    const button = el("button", { class: "btn btn--primary btn--sm", type: "button" }, "Submit");
    button.addEventListener("click", () => {
      void act("submissions", () => { const r = { ...base(), challengeId: ch.id, proofUrl: proof.value.trim(), requestedLamports: String(Math.round(Number(ask.value))) }; return { body: r, text: submissionMessage(r) }; }, "Submitted. The creator decides what to pay.");
    });
    return el("div", { class: "stack" }, proof, el("label", { class: "field" }, el("span", { class: "label label--sm" }, "You ask for "), shown, ask), button);
  }

  function submissionRow(ch: ChallengeView["challenges"][number], s: ChallengeView["challenges"][number]["submissions"][number], creator: boolean, admin: boolean) {
    const paid = s.awardedLamports ? `${sol(s.awardedLamports)} SOL` : "—";
    const row = el("tr", {},
      el("td", {}, el("a", { class: "mono", href: `https://solscan.io/account/${s.wallet}`, target: "_blank", rel: "noopener noreferrer" }, short(s.wallet))),
      el("td", {}, el("a", { href: s.proofUrl, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, "proof")),
      el("td", { class: "num" }, `${sol(s.requestedLamports)} SOL`),
      el("td", { class: "num" }, s.payoutSignature ? el("a", { href: `https://solscan.io/tx/${s.payoutSignature}`, target: "_blank", rel: "noopener noreferrer" }, paid) : paid),
      el("td", {}, STATUS[s.status] ?? s.status));
    if (creator && s.status === "pending" && ch.winners < ch.maxWinners) {
      const pay = el("input", { class: "input", type: "number", min: String(Number(ch.minRewardLamports) / 1e9), max: String(Number(ch.maxRewardLamports) / 1e9), step: "0.001", value: String(Number(s.requestedLamports) / 1e9), "aria-label": "Pay in SOL" }) as HTMLInputElement;
      const approve = el("button", { class: "btn btn--sm", type: "button" }, "Approve");
      const reject = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Reject");
      approve.addEventListener("click", () => {
        void act("decisions", () => { const r = { ...base(), submissionId: s.id, decision: "approve" as const, awardedLamports: toLamports(pay.value) }; return { body: r, text: decisionMessage(r) }; }, "Approved. The payout goes out within a minute.");
      });
      reject.addEventListener("click", () => {
        void act("decisions", () => { const r = { ...base(), submissionId: s.id, decision: "reject" as const, awardedLamports: "0" }; return { body: r, text: decisionMessage(r) }; }, "Rejected.");
      });
      row.append(el("td", {}, pay, approve, reject));
    }
    // A payout whose transfer outcome was unclear: an admin checks the chain first.
    if (admin && s.status === "review") {
      const paid = el("button", { class: "btn btn--sm", type: "button" }, "Mark paid");
      const again = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Pay again");
      paid.addEventListener("click", () => {
        if (!confirm("Mark paid? Only if the chain shows this transfer landed.")) return;
        void act("reviews", () => { const r = { ...base(), submissionId: s.id, resolution: "paid" as const }; return { body: r, text: reviewMessage(r) }; }, "Marked paid.");
      });
      again.addEventListener("click", () => {
        if (!confirm("Pay again? Only if the chain shows the last transfer never landed.")) return;
        void act("reviews", () => { const r = { ...base(), submissionId: s.id, resolution: "retry" as const }; return { body: r, text: reviewMessage(r) }; }, "Sent back for payment.");
      });
      row.append(el("td", {}, s.payoutSignature ? el("a", { href: `https://solscan.io/tx/${s.payoutSignature}`, target: "_blank", rel: "noopener noreferrer" }, "last transfer") : "", paid, again));
    }
    return row;
  }

  function paint() {
    if (!view) return;
    const creator = !!wallet && wallet === view.creatorWallet;
    const admin = !!wallet && view.admins.includes(wallet);
    const b = view.balance;
    const list = view.challenges.map((ch) => {
      const close = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Close");
      close.addEventListener("click", () => {
        void act("challenges", () => { const r = { ...base(), challengeId: ch.id }; return { body: { ...r, action: "close" }, text: challengeCloseMessage(r) }; }, "Challenge closed.");
      });
      return el("section", { class: "panel" },
        el("div", { class: "panel__head" }, el("span", { class: "label" }, ch.title), el("span", { class: "pill" }, ch.status === "open" ? `${ch.winners}/${ch.maxWinners} paid winners` : "Closed")),
        el("div", { class: "panel__body stack" },
          ch.description ? el("p", {}, ch.description) : null,
          el("p", { class: "dim" }, `Pays ${sol(ch.minRewardLamports)}–${sol(ch.maxRewardLamports)} SOL per submission. The creator decides the amount.`),
          ch.submissions.length ? el("div", { class: "table-wrap" }, el("table", { class: "table coin-table" },
            el("thead", {}, el("tr", {}, el("th", {}, "Wallet"), el("th", {}, "Proof"), el("th", { class: "num" }, "Asked"), el("th", { class: "num" }, "Paid"), el("th", {}, "Status"), creator || admin ? el("th", {}, "") : null)),
            el("tbody", {}, ...ch.submissions.map((s) => submissionRow(ch, s, creator, admin))))) : null,
          ch.status === "open" && ch.winners < ch.maxWinners ? submitForm(ch) : null,
          creator && ch.status === "open" ? close : null));
    });
    const connect = el("button", { class: "btn btn--sm", type: "button" }, wallet ? short(wallet) : "Connect wallet");
    connect.addEventListener("click", async () => { try { wallet = await connectWallet(window); paint(); } catch (error) { say(error instanceof Error ? error.message : "Could not connect.", true); } });
    root!.replaceChildren(
      el("div", { class: "panel__head" }, el("span", { class: "label" }, "Challenges"), connect),
      el("p", { class: "setting-help" }, `Fund: ${sol(b.available)} SOL free · ${sol(b.promised)} SOL set aside · ${sol(b.paid)} SOL paid · from ${sol(b.earned)} SOL of this coin's fees.`),
      ...(creator ? [postForm()] : []),
      ...(list.length ? list : [el("p", { class: "dim" }, "No challenges yet.")]),
      message);
  }

  const load = async () => {
    try { view = await getJson<ChallengeView>(`/api/coins/${encodeURIComponent(mint)}/challenges`); if (!stopped) paint(); } catch {}
  };
  void load();
  const timer = setInterval(() => { if (!document.hidden && !root.contains(document.activeElement)) void load(); }, 20_000);
  return () => { stopped = true; clearInterval(timer); };
}
