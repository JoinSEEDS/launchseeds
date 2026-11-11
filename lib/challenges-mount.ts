/** A live coin's challenge parts: its money in the stats row, its open
 * challenges, the submit form with an ask slider, and every submission with
 * what was asked and what was paid. The coin's creator posts, closes, approves
 * and rejects; an admin settles payouts in review. Every action is signed in the
 * visitor's wallet. */
import bs58 from "bs58";
import { connectWallet, subscribeWallet, walletAddress } from "./wallet-session";
import { walletProvider } from "./wallet-provider";
import { getJson, postJson } from "./client-request";
import { challengeCloseMessage, challengePostMessage, decisionMessage, reviewMessage, submissionMessage } from "./challenge-message";
import type { ChallengeView } from "../src/server/challenge-view";

type View = ChallengeView & { treasury?: string | null };
type Challenge = View["challenges"][number];
type Submission = Challenge["submissions"][number] & { challenge: Challenge };
type Tab = "pending" | "paid" | "rejected";

const sol = (lamports: string | number | bigint) => (Number(lamports) / 1e9).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const range = (c: Challenge) => (c.minRewardLamports === c.maxRewardLamports ? sol(c.minRewardLamports) : `${sol(c.minRewardLamports)}–${sol(c.maxRewardLamports)}`);
const toLamports = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 1e9)) : "";
};
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
function ago(at: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}
const TAB_OF: Record<string, Tab> = { pending: "pending", approved: "paid", paying: "paid", paid: "paid", review: "paid", rejected: "rejected" };
const AVATARS = ["#E3EEDA", "#ECE5F5", "#FBE6DD", "#E2EEF0"];

type Child = Node | string | null | undefined | false;
function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}
const icon = (id: string, size = 12) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("style", `width:${size}px;height:${size}px`);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
};
const link = (href: string, text: Child, cls = "", rel = "noopener noreferrer") => el("a", { href, target: "_blank", rel, ...(cls ? { class: cls } : {}) }, text);

export function mountChallenges(): () => void {
  const root = document.getElementById("challenges-root");
  const mint = root?.dataset.mint;
  if (!root || !mint) return () => {};
  const slot = (name: string) => root.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  let view: View | null = null, wallet = walletAddress() ?? "", stopped = false, tab: Tab = "pending", posting = false;
  /** The submit form survives repaints while its challenges stay the same, so typing is never lost. */
  let submitting: { key: string; node: HTMLElement } | null = null;
  const message = el("p", { class: "notice hidden", role: "status" });
  const say = (text: string, error = false) => {
    message.textContent = text;
    message.classList.toggle("hidden", !text);
    message.style.background = error ? "var(--amber-bg)" : "";
    message.style.color = error ? "var(--amber-ink)" : "";
  };

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
      view = { ...(await postJson<View>(`/api/coins/${encodeURIComponent(mint!)}/${path}`, { ...body, signature })), treasury: view?.treasury ?? null };
      say(done);
      paint();
      return true;
    } catch (error) {
      say(error instanceof Error ? error.message : "That didn't work.", true);
      return false;
    }
  }
  const base = () => ({ wallet, mint: mint!, issuedAt: Date.now(), nonce: nonce() });

  function field(label: string, input: HTMLElement) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    input.id = id;
    return el("div", { class: "field" }, el("label", { for: id }, label), input);
  }

  function postCard() {
    const title = el("input", { type: "text", maxlength: "120", placeholder: "Clean up a public space" }) as HTMLInputElement;
    const description = el("textarea", { rows: "3", maxlength: "2000", placeholder: "What to do and what proof counts" }) as HTMLTextAreaElement;
    const min = el("input", { type: "number", min: "0.001", step: "0.001", value: "0.01", inputmode: "decimal" }) as HTMLInputElement;
    const max = el("input", { type: "number", min: "0.001", step: "0.001", value: "0.1", inputmode: "decimal" }) as HTMLInputElement;
    const winners = el("input", { type: "number", min: "1", max: "100", step: "1", value: "5", inputmode: "numeric" }) as HTMLInputElement;
    const cancel = el("button", { class: "btn btn-white", type: "button" }, "Cancel");
    const post = el("button", { class: "btn btn-primary", type: "button" }, "Post challenge");
    cancel.addEventListener("click", () => { posting = false; paint(); });
    post.addEventListener("click", async () => {
      const ok = await act("challenges", () => {
        const r = { ...base(), title: title.value.trim(), description: description.value.trim(), minRewardLamports: toLamports(min.value), maxRewardLamports: toLamports(max.value), maxWinners: Number(winners.value) };
        return { body: { ...r, action: "post" }, text: challengePostMessage(r) };
      }, "Challenge posted.");
      if (ok) { posting = false; paint(); }
    });
    const free = view ? sol(view.balance.available) : "0";
    return el("section", { class: "card side-card" }, el("h2", {}, "New challenge"),
      el("p", { class: "hint" }, `Holds pay for every winner at the top of the range. ${free} SOL is free.`),
      field("Title", title), field("What counts as done", description),
      el("div", { class: "pay-range" }, field("Pay from (SOL)", min), field("to (SOL)", max)),
      field("Winners", winners),
      el("div", { class: "btn-row" }, cancel, post));
  }

  function challengeCard(ch: Challenge, creator: boolean) {
    const paid = ch.submissions.filter((s) => s.status === "paid").length;
    const close = el("button", { class: "btn btn-white", type: "button" }, "Close challenge");
    close.addEventListener("click", () => {
      if (!confirm("Close this challenge? It stops taking submissions.")) return;
      void act("challenges", () => { const r = { ...base(), challengeId: ch.id }; return { body: { ...r, action: "close" }, text: challengeCloseMessage(r) }; }, "Challenge closed.");
    });
    const bar = el("div", { class: "progress lg", role: "progressbar", "aria-label": "Completions paid", "aria-valuemin": "0", "aria-valuemax": String(ch.maxWinners), "aria-valuenow": String(paid) }, el("span", { style: `width:${Math.min(100, (paid / ch.maxWinners) * 100)}%` }));
    return el("section", { class: "card challenge-card" },
      el("div", { class: "banner" }, el("img", { src: "/hills.jpg", alt: "" }), el("span", { class: "chip" }, "Active challenge")),
      el("div", { class: "inner" },
        el("h2", {}, ch.title),
        ch.description ? el("p", { class: "desc" }, ch.description) : null,
        el("p", { class: "range-note" }, "You choose what you think your work is worth within the range. The creator sets the final payout, and both amounts are public."),
        el("div", { class: "mini" },
          el("div", { class: "g" }, el("span", {}, "Reward range"), el("b", {}, `${range(ch)} SOL`)),
          el("div", { class: "l" }, el("span", {}, "Winners"), el("b", {}, `${ch.winners} / ${ch.maxWinners}`))),
        el("div", {}, el("div", { class: "progress-row" }, el("span", {}, "Completions paid"), el("b", {}, `${paid} / ${ch.maxWinners}`)), bar),
        creator ? el("div", { class: "btn-row" }, close) : null));
  }

  function submitCard(open: Challenge[]) {
    let ch = open[0]!;
    const pick = el("select", {}, ...open.map((c) => el("option", { value: String(c.id) }, c.title))) as HTMLSelectElement;
    const proof = el("input", { type: "url", placeholder: "Photos, post or album URL", autocomplete: "off" }) as HTMLInputElement;
    const ask = el("input", { type: "range" }) as HTMLInputElement;
    const shown = el("output", {});
    const lo = el("span", {}), hi = el("span", {});
    const note = el("textarea", { rows: "3", maxlength: "500", placeholder: "Where, when, and what you did" }) as HTMLTextAreaElement;
    const send = el("button", { class: "btn btn-primary btn-block", type: "button", style: "min-height:48px" }, "Submit for review") as HTMLButtonElement;
    const paintAsk = () => {
      shown.textContent = `${sol(ask.value)} SOL`;
      const span = Number(ask.max) - Number(ask.min);
      ask.style.setProperty("--fill", `${span ? ((Number(ask.value) - Number(ask.min)) / span) * 100 : 100}%`);
    };
    const setChallenge = () => {
      ch = open.find((c) => String(c.id) === pick.value) ?? open[0]!;
      const a = Number(ch.minRewardLamports), b = Number(ch.maxRewardLamports);
      ask.min = String(a); ask.max = String(b); ask.step = String(Math.max(1, Math.round((b - a) / 100)));
      ask.value = String(Math.round((a + b) / 2));
      lo.textContent = `${sol(a)} SOL`; hi.textContent = `${sol(b)} SOL`;
      paintAsk();
    };
    const valid = () => { send.disabled = !proof.value.trim(); };
    pick.addEventListener("change", setChallenge);
    ask.addEventListener("input", paintAsk);
    proof.addEventListener("input", valid);
    send.addEventListener("click", async () => {
      const ok = await act("submissions", () => {
        const r = { ...base(), challengeId: ch.id, proofUrl: proof.value.trim(), requestedLamports: String(Math.round(Number(ask.value))), note: note.value.trim() };
        return { body: r, text: submissionMessage(r) };
      }, "Submitted. The creator decides what to pay.");
      if (ok) { submitting = null; tab = "pending"; paint(); }
    });
    setChallenge(); valid();
    const askId = `f-ask-${ch.id}`;
    ask.id = askId;
    return el("section", { class: "card side-card", "aria-labelledby": "sub-h" },
      el("h2", { id: "sub-h" }, "Submit your task"),
      open.length > 1 ? field("Challenge", pick) : null,
      field("Proof link", proof),
      el("div", { class: "field" },
        el("label", { for: askId }, "How much do you think you deserve?"),
        el("div", { class: "ask-row" }, ask, shown),
        el("div", { class: "range-ends" }, lo, hi),
        el("p", { class: "hint" }, "Your ask is shown publicly. The creator decides the final amount within the range. You are paid to the wallet that signs.")),
      field("What did you do?", note),
      send);
  }

  function submitNode(open: Challenge[]) {
    const key = open.map((c) => c.id).join(",");
    if (submitting?.key !== key) submitting = { key, node: submitCard(open) };
    return submitting.node;
  }

  function diffTag(s: Submission) {
    const d = BigInt(s.awardedLamports ?? "0") - BigInt(s.requestedLamports);
    if (d === 0n) return el("span", { class: "diff even" }, "Paid in full");
    return d < 0n ? el("span", { class: "diff under" }, `${sol(-d)} below ask`) : el("span", { class: "diff over" }, `${sol(d)} above ask`);
  }

  function task(s: Submission, i: number, creator: boolean, admin: boolean, several: boolean) {
    const ch = s.challenge;
    let amounts: HTMLElement, right: Child = null;
    if (TAB_OF[s.status] === "paid") {
      const state = s.status === "paid" ? null : el("span", { class: "status status-pending" }, s.status === "review" ? "Payout being checked" : "Paying");
      amounts = el("div", { class: "amounts" }, el("span", { class: "ask" }, `Asked ${sol(s.requestedLamports)} SOL`), el("span", { class: "paid" }, s.status === "paid" ? "Paid " : "Approved ", el("b", {}, `${sol(s.awardedLamports ?? "0")} SOL`)), diffTag(s), state);
      if (s.payoutSignature) right = link(`https://solscan.io/tx/${s.payoutSignature}`, el("span", {}, `tx ${short(s.payoutSignature)} `, icon("i-ext")), "tx-link");
      if (admin && s.status === "review") {
        const paid = el("button", { class: "btn btn-white", type: "button", style: "font-size:14px" }, "Mark paid");
        const again = el("button", { class: "btn btn-primary", type: "button", style: "font-size:14px" }, "Pay again");
        paid.addEventListener("click", () => {
          if (!confirm("Mark paid? Only if the chain shows this transfer landed.")) return;
          void act("reviews", () => { const r = { ...base(), submissionId: s.id, resolution: "paid" as const }; return { body: r, text: reviewMessage(r) }; }, "Marked paid.");
        });
        again.addEventListener("click", () => {
          if (!confirm("Pay again? Only if the chain shows the last transfer never landed.")) return;
          void act("reviews", () => { const r = { ...base(), submissionId: s.id, resolution: "retry" as const }; return { body: r, text: reviewMessage(r) }; }, "Sent back for payment.");
        });
        right = el("div", { class: "actions" }, right, paid, again);
      }
    } else if (s.status === "rejected") {
      amounts = el("div", { class: "amounts" }, el("span", { class: "ask" }, `Asked ${sol(s.requestedLamports)} SOL`), el("span", { class: "status status-rejected" }, "Rejected · nothing paid"));
    } else {
      amounts = el("div", { class: "amounts" }, el("span", { class: "ask-big" }, "Asks ", el("b", {}, `${sol(s.requestedLamports)} SOL`)), el("span", { class: "status status-pending" }, "Waiting for review"));
      if (creator) {
        const full = ch.winners >= ch.maxWinners;
        const pay = el("input", { type: "number", inputmode: "decimal", min: String(Number(ch.minRewardLamports) / 1e9), max: String(Number(ch.maxRewardLamports) / 1e9), step: "0.001", value: String(Number(s.requestedLamports) / 1e9), id: `pay-${s.id}` }) as HTMLInputElement;
        const reject = el("button", { class: "btn btn-white", type: "button", style: "font-size:14px;padding:0 16px" }, "Reject");
        const approve = el("button", { class: "btn btn-primary", type: "button", style: "font-size:14px" }, "Approve & pay") as HTMLButtonElement;
        const check = () => {
          const v = Number(pay.value), ok = v * 1e9 >= Number(ch.minRewardLamports) - 1 && v * 1e9 <= Number(ch.maxRewardLamports) + 1;
          pay.setAttribute("aria-invalid", ok ? "false" : "true");
          approve.disabled = full || !ok;
          approve.title = full ? "This challenge has all its winners" : ok ? "" : `Enter an amount between ${range(ch)} SOL`;
        };
        pay.addEventListener("input", check); check();
        approve.addEventListener("click", () => {
          void act("decisions", () => { const r = { ...base(), submissionId: s.id, decision: "approve" as const, awardedLamports: toLamports(pay.value) }; return { body: r, text: decisionMessage(r) }; }, "Approved. The payout goes out within a minute.");
        });
        reject.addEventListener("click", () => {
          void act("decisions", () => { const r = { ...base(), submissionId: s.id, decision: "reject" as const, awardedLamports: "0" }; return { body: r, text: decisionMessage(r) }; }, "Rejected.");
        });
        right = el("div", { class: "actions" }, el("div", { class: "payout" }, el("label", { for: `pay-${s.id}` }, "Pay"), pay, el("span", {}, "SOL")), reject, approve);
      }
    }
    let proofLabel = "link";
    try { proofLabel = new URL(s.proofUrl).hostname.replace(/^www\./, ""); } catch {}
    return el("article", { class: "task" },
      el("div", { class: "who" },
        el("span", { class: "avatar", "aria-hidden": "true", style: `background:${AVATARS[i % 4]}` }, s.wallet.slice(0, 2).toUpperCase()),
        el("div", { style: "min-width:0" },
          el("div", { class: "line1" }, link(`https://solscan.io/account/${s.wallet}`, short(s.wallet), "wallet"), el("span", { class: "when" }, ago(s.createdAt))),
          several ? el("span", { class: "note" }, ch.title) : null,
          s.note ? el("span", { class: "note" }, s.note) : null,
          link(s.proofUrl, `View proof · ${proofLabel}`, "proof", "noopener noreferrer nofollow ugc"))),
      amounts, right);
  }

  function paintTasks() {
    const box = slot("tasks");
    if (!box || !view) return;
    const creator = !!wallet && wallet === view.creatorWallet, admin = !!wallet && view.admins.includes(wallet);
    const all: Submission[] = view.challenges.flatMap((c) => c.submissions.map((s) => ({ ...s, challenge: c }))).sort((a, b) => b.createdAt - a.createdAt);
    const count = (t: Tab) => all.filter((s) => TAB_OF[s.status] === t).length;
    const tabs = el("div", { class: "segmented", role: "tablist", "aria-label": "Submission status" },
      ...([["pending", "Submitted"], ["paid", "Paid"], ["rejected", "Rejected"]] as const).map(([t, label]) => {
        const b = el("button", { type: "button", role: "tab", "aria-selected": String(t === tab) }, `${label} `, el("span", { class: "count" }, String(count(t))));
        b.addEventListener("click", () => { tab = t; paintTasks(); });
        return b;
      }));
    const rows = all.filter((s) => TAB_OF[s.status] === tab);
    const hint = creator ? "Set the final payout within the range. The participant’s ask stays visible next to it." : "Every ask and every payout is public.";
    box.replaceChildren(
      el("div", { class: "panel-head tasks-head" }, el("div", {}, el("h2", { id: "tasks-h" }, "Task submissions"), el("p", {}, hint)), tabs),
      el("div", { class: "task-list", role: "tabpanel", "aria-labelledby": "tasks-h" },
        ...(rows.length ? rows.map((s, i) => task(s, i, creator, admin, view!.challenges.length > 1)) : [el("div", { class: "empty" }, tab === "pending" ? "No submissions waiting." : "Nothing here yet.")])));
  }

  function paint() {
    if (!view) return;
    const creator = !!wallet && wallet === view.creatorWallet;
    const b = view.balance, all = view.challenges.flatMap((c) => c.submissions);
    const paidList = all.filter((s) => s.status === "paid");
    const asked = paidList.reduce((n, s) => n + Number(s.requestedLamports), 0);
    const set = (name: string, text: string) => root!.querySelectorAll(`[data-stat="${name}"]`).forEach((n) => { n.textContent = text; });
    set("earned", sol(b.earned));
    set("available", sol(b.available));
    set("paid", sol(b.paid));
    set("paidsub", `${paidList.length} ${paidList.length === 1 ? "task" : "tasks"}${asked ? ` · ${Math.round((Number(b.paid) / asked) * 100)}% of what was asked` : ""}`);
    set("waiting", String(all.filter((s) => s.status === "pending").length));
    const treasury = document.querySelector("[data-treasury-wallet]");
    if (treasury && view.treasury) treasury.replaceChildren(link(`https://solscan.io/account/${view.treasury}`, short(view.treasury)));
    const hint = document.querySelector("[data-role-hint]");
    if (hint) hint.textContent = creator ? "You created this coin. Post challenges and approve submissions to pay them from its fees." : "Complete a challenge and submit proof to be paid from this coin’s trading fees.";

    const open = view.challenges.filter((c) => c.status === "open").sort((x, y) => y.id - x.id);
    const takers = open.filter((c) => c.winners < c.maxWinners);
    const side = slot("side");
    if (side) {
      const newButton = el("button", { class: "btn btn-dark", type: "button" }, open.length ? "New challenge" : "Create a challenge");
      newButton.addEventListener("click", () => { posting = true; paint(); });
      side.replaceChildren(
        message,
        ...(posting && creator ? [postCard()] : []),
        ...open.map((c) => challengeCard(c, creator)),
        ...(open.length ? [] : [el("section", { class: "card side-card" }, el("h2", {}, "No challenge yet"), el("p", { class: "hint" }, "Fees collect for this coin until its creator posts one."), creator && !posting ? newButton : null)]),
        ...(creator && !posting && open.length ? [el("div", { class: "btn-row" }, newButton)] : []),
        ...(takers.length && !creator ? [submitNode(takers)] : []));
    }
    paintTasks();
  }

  const load = async () => {
    try {
      view = await getJson<View>(`/api/coins/${encodeURIComponent(mint)}/challenges`);
      if (!stopped) paint();
    } catch {}
  };
  const unsubscribe = subscribeWallet((address) => { if (address !== wallet) { wallet = address; paint(); } });
  void load();
  const busy = () => { const a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const timer = setInterval(() => { if (!document.hidden && !busy() && !posting) void load(); }, 20_000);
  return () => { stopped = true; clearInterval(timer); unsubscribe(); };
}
