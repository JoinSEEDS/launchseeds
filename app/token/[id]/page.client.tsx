import { render } from "tradjs/client";
import { elapsedText } from "../../../src/domain/launch-settings";
import {
  publishWallet,
  publishWalletDisconnected,
  trackWalletProvider,
} from "../../../lib/wallet-session";
import bs58 from "bs58";
import { cardClaimMessage } from "../../../lib/card-claim";
import {
  createStrategyBuilder,
  StrategyLabel,
} from "../../components/strategy-builder";
import {
  getJson,
  postJson,
  SequentialPoller,
} from "../../../lib/client-request";
import type { Catalog } from "../../../lib/catalog";
import {
  describeReadiness,
  microsToUsd,
  type TreasuryReadiness,
} from "../../../lib/treasury-readiness";
import {
  strategyKey,
  strategyName,
  type Strategy,
} from "../../../lib/strategy";
import {
  countdownText,
  eligibleTurnout,
  formatGravity,
  formatPercentage,
  proposalSummary,
  selectedStrategy,
  shortWallet,
  strategyStatus,
  validBoard,
  voteShare,
  walletProvider,
  type PublicBoard,
  type WalletProvider,
} from "../../../lib/vote-ui";

type Position = {
  wallet: string;
  balance: number;
  gravity: number;
  totalGravity: number;
};
type HolderSnapshot = {
  mint: string;
  symbol: string;
  leaderboard: { holders: (Position & { heldSince: number; probability: number })[] };
};

type VoteChallenge = { nonce: string; message: string; expiresAt: number };
type TreasuryView = {
  mint: string;
  ready: TreasuryReadiness;
  statusText: string;
  unclaimedFeesMicros?: number | null;
  canExecute: false;
  asOf: number;
};
function validTreasuryView(value: unknown): value is TreasuryView {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.ready || typeof v.ready !== "object") return false;
  const r = v.ready as Record<string, unknown>;
  return (
    typeof v.mint === "string" &&
    typeof v.statusText === "string" &&
    v.canExecute === false &&
    typeof r.observedAt === "number" &&
    typeof r.recordedAvailableMicros === "number" &&
    typeof r.planningReason === "string" &&
    Boolean(r.quote)
  );
}

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing token element: ${id}`);
  return result as T;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected request error occurred.";
}

export default function mount() {
  const host = document.getElementById("governed-token");
  if (!host) return;
  // Public APIs are addressed by the token's CA.
  const mint = host.dataset.tokenMint || "";
  const distribution = element<HTMLElement>("strategy-distribution");
  const activeRoot = element<HTMLElement>("active-strategy");
  const votesRoot = document.querySelector<HTMLElement>("[data-votes-body]")!;
  const message = element<HTMLElement>("vote-message");
  const modalMessage = element<HTMLElement>("vote-modal-feedback");
  const holderError = element<HTMLElement>("holder-error");
  const positionRoot = element<HTMLElement>("holder-info");
  const voteRoot = element<HTMLElement>("vote-strategy-builder");
  const dialog = element<HTMLDialogElement>("vote-modal");
  const signButton = element<HTMLButtonElement>("sign-vote");
  const connectButton = element<HTMLButtonElement>("connect-holder");
  const openButton = element<HTMLButtonElement>("open-vote");
  const closeButton = element<HTMLButtonElement>("close-vote");
  const turnout = element<HTMLElement>("strategy-turnout");

  let board: PublicBoard | null = null;
  let catalog: Catalog | null = null;
  let builder: ReturnType<typeof createStrategyBuilder> | null = null;
  let provider: WalletProvider | null = null;
  let wallet = "";
  let position: Position | null = null;
  let signing = false;
  let destroyed = false;
  let poller: SequentialPoller | null = null;
  let treasuryPoller: SequentialPoller | null = null;
  let lastTreasuryAt = 0;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  const setMessage = (node: HTMLElement, text: string, isError = false) => {
    node.textContent = text;
    node.classList.toggle("is-error", isError);
  };

  const retrieveBoard = async (signal?: AbortSignal): Promise<PublicBoard> => {
    const search = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    const loaded = await getJson<unknown>(
      `/api/strategies/${encodeURIComponent(mint)}${search}`,
      {
        signal,
        timeoutMs: 12_000,
      },
    );
    if (!validBoard(loaded)) throw new Error("Governance data is unavailable.");
    return loaded;
  };

  /** The live countdown reads the *server* deadline; it never changes state. */
  const updateCountdown = () => {
    const activeLock = document.getElementById("active-lock-text");
    if (activeLock) {
      const until = Number(activeLock.dataset.lockUntil ?? "0");
      if (until > 0) {
        const left = Math.max(0, until - Date.now());
        const text = left >= 3_600_000 ?
          `${Math.ceil(left / 3_600_000)}h` :
          `${Math.ceil(left / 60_000)}m`;
        activeLock.textContent = left <= 0 ? "open to takeover" : activeLock.dataset.creatorLocked === "true" ?
          `locked for ${text}` : `can change in ${text}`;
      }
    }
    const since = document.getElementById("active-since");
    const started = Number(since?.dataset.activeSince ?? "0");
    if (since && started > 0) since.textContent = `Active ${elapsedText(Date.now() - started)}`;
    const deadline = board?.takeoverAt ?? null;
    const text = countdownText(deadline);
    distribution
      .querySelectorAll<HTMLElement>("[data-countdown]")
      .forEach((node) => {
        node.textContent = text || "0:00";
      });
  };

  function paintPosition() {
    if (!wallet || !position) {
      render(null, positionRoot);
      positionRoot.hidden = true;
      connectButton.hidden = false;
      element<HTMLElement>("holder-disconnected").hidden = false;
      return;
    }
    const snapshot = position;
    const share = snapshot.totalGravity
      ? formatPercentage((snapshot.gravity * 100) / snapshot.totalGravity, 2)
      : "0.00%";
    positionRoot.hidden = false;
    connectButton.hidden = true;
    element<HTMLElement>("holder-disconnected").hidden = true;
    render(
      <>
        <div className="position-wallet">
          <span className="mono mono--md" title={wallet}>
            {shortWallet(wallet)}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        </div>
        <dl className="dl">
          <dt>Indexed balance</dt>
          <dd data-num="">{formatGravity(snapshot.balance)}</dd>
          <dt>Voting gravity</dt>
          <dd data-num="">{formatGravity(snapshot.gravity)}</dd>
          <dt>Eligible share</dt>
          <dd data-num="">{share}</dd>
        </dl>
      </>,
      positionRoot,
    );
  }

  function paintDistribution() {
    if (!board) return;
    const current = board;
    const total = current.tally.reduce((sum, row) => sum + row.gravity, 0);
    render(
      <>
        {current.tally.length ? (
          current.tally.map((row) => {
            const status = strategyStatus(current, row);
            const mine = selectedStrategy(current, wallet, row.config);
            const share = voteShare(row.gravity, total);
            return (
              <div
                className={`dist-row${status.active ? " is-active" : ""}${mine ? " is-mine" : ""}`}
              >
                <span className="ballot-name">
                  {catalog ? (
                    <StrategyLabel strategy={row.config} catalog={catalog} />
                  ) : (
                    strategyName(row.config)
                  )}
                  {mine ? (
                    <span className="pill pill--lead pill--plain">
                      YOUR VOTE
                    </span>
                  ) : null}
                  {status.active ? (
                    <span className="pill pill--active">ACTIVE</span>
                  ) : status.takingOver ? (
                    <span className="pill pill--wait">
                      TAKES OVER IN{" "}
                      <b data-countdown>
                        {countdownText(current.takeoverAt) || "0:00"}
                      </b>
                    </span>
                  ) : null}
                </span>
                <span className="ballot-share">
                  <span className="bar">
                    <i style={{ width: `${share}%` }} />
                  </span>
                  <b data-num="">{formatPercentage(share)}</b>
                  <small data-num="">
                    {formatGravity(row.gravity)} gravity · {row.voters} voters
                  </small>
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={mine || signing}
                  aria-label={`Vote for ${strategyName(row.config, catalog || undefined)}`}
                  onClick={() => openVote(row.config)}
                >
                  {mine ? "Voted" : "Vote"}
                </button>
              </div>
            );
          })
        ) : (
          <div className="empty">
            No votes yet. You can propose any available strategy.
          </div>
        )}
      </>,
      distribution,
    );
    updateCountdown();
  }

  function paintVoteLedger() {
    if (!board) return;
    const votes = board.votes;
    render(
      <>
        {votes.length ? (
          votes.map((vote) => (
            <tr>
              <td>
                <span className="cell-2">
                  <span className="mono mono--md" title={vote.wallet}>{shortWallet(vote.wallet)}</span>
                  <small>
                    {formatGravity(vote.gravity)} gravity
                    {board?.totalGravity
                      ? ` · ${formatPercentage((vote.gravity * 100) / board.totalGravity)}`
                      : ""}
                  </small>
                </span>
              </td>
              <td>{strategyName(vote.config, catalog || undefined)}</td>
              <td className="num dim" title={new Date(vote.votedAt).toLocaleString()}>
                {`${elapsedText(Date.now() - vote.votedAt)} ago`}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3} className="empty-table">
              No recorded votes.
            </td>
          </tr>
        )}
      </>,
      votesRoot,
    );
  }

  /** Treasury updates are independent of the voting timer and never submit payments. */
  function paintTreasury(view: TreasuryView) {
    if (destroyed || view.mint !== mint || view.ready.observedAt < lastTreasuryAt)
      return;
    // Do not show a price for a different strategy during a leadership switch.
    if (board && view.ready.quote.strategyKey !== strategyKey(board.active))
      return;
    lastTreasuryAt = view.ready.observedAt;
    const result = view.ready;
    const available = element<HTMLElement>("treasury-available");
    const needed = element<HTMLElement>("treasury-needed");
    const deficit = element<HTMLElement>("next-reward-deficit");
    const progress = element<HTMLElement>("treasury-progress");
    const note = element<HTMLElement>("treasury-verification");
    available.textContent = microsToUsd(result.recordedAvailableMicros);
    const fees = view.unclaimedFeesMicros;
    if (typeof fees === "number") {
      element<HTMLElement>("treasury-fees").textContent = microsToUsd(fees);
      element<HTMLElement>("treasury-fees-row").hidden = false;
    }
    needed.textContent =
      result.quote.costMicros === null
        ? "Awaiting price"
        : `of ${microsToUsd(result.quote.costMicros)}`;
    deficit.textContent =
      result.deficitMicros === null
        ? "Awaiting a fresh quote"
        : `${microsToUsd(result.deficitMicros)} to go`;
    progress.setAttribute(
      "aria-valuenow",
      String(Math.floor(result.progressPercent ?? 0)),
    );
    const bar = progress.querySelector<HTMLElement>("i");
    if (bar) bar.style.width = `${result.progressPercent ?? 0}%`;
    // Funding validation stays server-side; do not surface data-source status in the UI.
    note.textContent = "";
  }

  async function refreshTreasury(signal?: AbortSignal) {
    const value = await getJson<unknown>(
      `/api/treasury/${encodeURIComponent(mint)}`,
      {
        signal,
        timeoutMs: 15_000,
      },
    );
    if (!validTreasuryView(value))
      throw new Error("Incomplete treasury status.");
    paintTreasury(value);
  }

  function paintBoard() {
    if (!board || destroyed) return;
    const current = board;
    render(
      catalog ? (
        <StrategyLabel strategy={current.active} catalog={catalog} />
      ) : (
        <span>{strategyName(current.active)}</span>
      ),
      activeRoot,
    );
    paintDistribution();
    const activeLock = document.getElementById("active-lock-text");
    if (activeLock && typeof current.lockUntil === "number") {
      activeLock.dataset.lockUntil = String(current.lockUntil);
      activeLock.dataset.creatorLocked = current.creatorLockUntil !== undefined &&
        current.creatorLockUntil > Date.now() &&
        strategyKey(current.active) === strategyKey(current.initial)
        ? "true" : "false";
    }
    updateCountdown();
    const allGravity = Math.max(0, current.totalGravity);
    const bar = document.querySelector<HTMLElement>("[data-turnout-bar]");
    if (bar)
      render(
        <>
          {current.tally.slice(0, 12).map((entry, index) => (
            <i
              style={{
                width: `${allGravity ? (100 * entry.gravity) / allGravity : 0}%`,
                background: [
                  "var(--s-stocks)",
                  "var(--accent)",
                  "var(--s-burn)",
                  "var(--s-github)",
                ][index % 4],
              }}
            />
          ))}
        </>,
        bar,
      );
    paintVoteLedger();
    turnout.textContent = formatPercentage(current.turnoutPercentage ?? 0);
    element<HTMLElement>("voter-count").textContent = String(current.voters);
    paintPosition();
    if (builder?.value) {
      setMessage(modalMessage, proposalSummary(current, builder.value));
    }
  }

  async function refreshBoard(signal?: AbortSignal) {
    const sequence = ++generation;
    const requestedWallet = wallet;
    const [loaded, snapshot, freshPosition] = await Promise.all([
      retrieveBoard(signal),
      getJson<HolderSnapshot>(`/api/tokens/${encodeURIComponent(mint)}`, { signal }),
      requestedWallet ? getJson<Position>(
        `/api/tokens/${encodeURIComponent(mint)}/chance?wallet=${encodeURIComponent(requestedWallet)}`,
        { signal },
      ) : Promise.resolve(null),
    ]);
    if (destroyed || sequence !== generation || wallet !== requestedWallet) return;
    board = loaded;
    if (freshPosition?.wallet === requestedWallet) position = freshPosition;
    paintBoard();
    const ledger = document.getElementById("gravity-ledger-body");
    if (ledger && snapshot.mint === mint && Array.isArray(snapshot.leaderboard?.holders)) {
      const holders = snapshot.leaderboard.holders.slice(0, 100);
      render(<>{holders.length ? holders.map((holder) => (
        <tr>
          <td><span className="cell-2"><span className="mono mono--md" title={holder.wallet}>{shortWallet(holder.wallet)}</span>
            <small>{formatGravity(holder.balance)} ${snapshot.symbol}</small></span></td>
          <td className="num">{holder.heldSince ? elapsedText(Date.now() - holder.heldSince) : "—"}</td>
          <td><span className="meter"><span className="bar"><i style={{width: `${100 * holder.probability}%`}} /></span>
            <b>{formatPercentage(100 * holder.probability)}</b></span><small data-num="">{formatGravity(holder.gravity)} gravity</small></td>
        </tr>
      )) : <tr><td colSpan={3} className="empty-table">No indexed eligible holders.</td></tr>}</>, ledger);
    }
  }

  function startPolling() {
    poller?.stop();
    poller = new SequentialPoller(refreshBoard, 5000, () => {
      // Keep the current ballot visible until the next refresh. Do not
      // replace the user's voting instructions with connection notices.
    });
    poller.start();
    treasuryPoller?.stop();
    treasuryPoller = new SequentialPoller(refreshTreasury, 15_000, () => {
      // Preserve the last rendered values without exposing an internal
      // data-source error to users. A subsequent read can recover.
    });
    treasuryPoller.start();
    countdownTimer = setInterval(updateCountdown, 1000);
  }

  async function connectWallet() {
    const found = walletProvider(window);
    if (!found) {
      throw new Error("Connect a Solana wallet that supports message signing.");
    }
    const response = await found.connect();
    const account = response.publicKey?.toString();
    if (!account || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account)) {
      throw new Error("Wallet returned an invalid Solana address.");
    }
    provider = found;
    wallet = account;
    trackWalletProvider(found);
    publishWallet(account);
    const accountInfo = await getJson<Position>(
      `/api/tokens/${encodeURIComponent(mint)}/chance?wallet=${encodeURIComponent(wallet)}`,
    );
    if (destroyed || wallet !== account) return wallet;
    position = accountInfo;
    setMessage(holderError, "");
    paintPosition();
    // Public board responses may include the requested wallet's vote even when
    // the public ledger is limited to the most recent 100 voters.
    await refreshBoard();
    return wallet;
  }

  async function disconnect() {
    const previous = provider;
    wallet = "";
    provider = null;
    position = null;
    paintPosition();
    paintBoard();
    try {
      await previous?.disconnect?.();
    } catch {
      /* wallet handles disconnect */
    }
    publishWalletDisconnected();
    await refreshBoard().catch(() => {});
  }

  const onSharedWallet = (event: Event) => {
    if (destroyed) return;
    const next =
      (event as CustomEvent<{ address?: string }>).detail?.address || "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(next) || next === wallet) return;
    // Account changes invalidate the old position immediately. A stale
    // holder response must never be rendered under a different account.
    wallet = next;
    position = null;
    provider = walletProvider(window);
    paintPosition();
    const requested = next;
    void getJson<Position>(
      `/api/tokens/${encodeURIComponent(mint)}/chance?wallet=${encodeURIComponent(requested)}`,
    )
      .then(async (fresh) => {
        if (destroyed || wallet !== requested) return;
        position = fresh;
        paintPosition();
        await refreshBoard();
      })
      .catch((error) => {
        if (!destroyed && wallet === requested)
          setMessage(holderError, errorText(error), true);
      });
  };
  const onSharedDisconnected = () => {
    if (destroyed || !wallet) return;
    // Native wallet disconnects can happen outside this page's own button.
    // Clear the holder-specific view immediately rather than showing the
    // previous account's balance, gravity, or selected vote.
    wallet = "";
    provider = null;
    position = null;
    paintPosition();
    paintBoard();
    void refreshBoard().catch(() => {});
  };
  window.addEventListener("launchseeds:wallet-disconnected", onSharedDisconnected);
  window.addEventListener("launchseeds:wallet", onSharedWallet);

  connectButton.addEventListener("click", async () => {
    connectButton.disabled = true;
    try {
      await connectWallet();
    } catch (error) {
      setMessage(holderError, errorText(error), true);
    } finally {
      connectButton.disabled = false;
    }
  });

  function openVote(strategy?: Strategy) {
    if (!builder) {
      setMessage(
        message,
        "Strategy choices are loading. Try again shortly.",
        true,
      );
      return;
    }
    if (strategy) builder.set(strategy);
    if (!dialog.open) dialog.showModal();
    builder.focus();
  }

  openButton.addEventListener("click", () => openVote());
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => setMessage(modalMessage, ""));
  // Outside-click close for every dialog is handled once in app/layout.client.tsx.

  function setSigning(value: boolean) {
    signing = value;
    signButton.disabled = value;
    signButton.textContent = value ? "Confirm in wallet…" : "Sign Vote";
    signButton.setAttribute("aria-busy", String(value));
  }

  signButton.addEventListener("click", async () => {
    if (signing || !builder) return;
    const candidate = builder.get();
    if ("error" in candidate) {
      setMessage(
        modalMessage,
        candidate.error || "Choose a valid strategy.",
        true,
      );
      return;
    }
    setSigning(true);
    try {
      if (!wallet || !provider) await connectWallet();
      if (
        !position ||
        !Number.isFinite(position.gravity) ||
        position.gravity <= 0
      ) {
        throw new Error(
          "No eligible holder gravity is indexed for this wallet.",
        );
      }
      if (!provider) throw new Error("Wallet signing is unavailable.");
      setMessage(modalMessage, "Requesting a one-time voting challenge…");
      const challenge = await postJson<VoteChallenge>(
        `/api/strategies/${encodeURIComponent(mint)}`,
        { action: "challenge", wallet, strategy: candidate.config },
      );
      if (
        !challenge.nonce ||
        !challenge.message ||
        challenge.expiresAt <= Date.now()
      ) {
        throw new Error("Voting challenge has expired.");
      }
      setMessage(modalMessage, "Review and sign the vote in your wallet.");
      const signature = await provider.signMessage(
        new TextEncoder().encode(challenge.message),
        "utf8",
      );
      const result = await postJson<unknown>(
        `/api/strategies/${encodeURIComponent(mint)}`,
        {
          action: "vote",
          wallet,
          strategy: candidate.config,
          nonce: challenge.nonce,
          signature: bs58.encode(signature.signature),
        },
      );
      if (!validBoard(result)) throw new Error("Vote receipt was invalid.");
      board = result;
      dialog.close();
      setMessage(
        message,
        `Vote recorded for ${strategyName(candidate.config, catalog || undefined)}. You may change it at any time.`,
      );
      paintBoard();
    } catch (error) {
      setMessage(modalMessage, errorText(error), true);
    } finally {
      setSigning(false);
    }
  });

  // The shared layout owns delegated copy actions. Avoid duplicate listeners.

  async function initialize() {
    // Show public votes even if third-party asset catalogs are unavailable.
    const [boardResult, catalogResult] = await Promise.allSettled([
      retrieveBoard(),
      getJson<Catalog>("/api/catalog", { timeoutMs: 12_000 }),
    ]);
    if (destroyed) return;
    if (boardResult.status !== "fulfilled") {
      setMessage(message, errorText(boardResult.reason), true);
      return;
    }
    board = boardResult.value;
    catalog =
      catalogResult.status === "fulfilled"
        ? catalogResult.value
        : {
            packs: [],
            stocks: [],
            packsAvailable: false,
            stocksAvailable: false,
            updatedAt: Date.now(),
          };
    builder = createStrategyBuilder(voteRoot, {
      catalog,
      tabs: ["pack", "stock"],
      initial: board.active,
      onChange: (value) => {
        if (value && board)
          setMessage(modalMessage, proposalSummary(board, value));
      },
    });
    if (catalogResult.status === "rejected") {
      setMessage(
        message,
        "Live pack and stock listings are temporarily unavailable. Other strategies remain selectable.",
      );
    }
    paintBoard();
    startPolling();
  }

  // Winners claim cards held in the treasury: sign a free message, the server
  // transfers the card. Only the winning wallet's signature is accepted.
  const rewards = document.getElementById("ledger-rewards");
  const claimMessage = document.getElementById("claim-message");
  const onClaim = async (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-claim-card]");
    if (!button || button.disabled || !claimMessage) return;
    const nftMint = button.dataset.claimCard!;
    const winner = button.dataset.winner!;
    claimMessage.hidden = false;
    button.disabled = true;
    try {
      if (!wallet || !provider) await connectWallet();
      if (wallet !== winner) throw new Error(`This card was won by ${winner.slice(0, 4)}…${winner.slice(-4)}. Connect that wallet to claim it.`);
      setMessage(claimMessage, "Sign the claim in your wallet. It is free and sends nothing.");
      const issuedAt = Date.now();
      const signed = await provider!.signMessage(new TextEncoder().encode(cardClaimMessage(nftMint, wallet, issuedAt)), "utf8");
      setMessage(claimMessage, "Sending your card…");
      const result = await postJson<{ signature: string }>(
        "/api/cards/claim",
        { nftMint, wallet, issuedAt, signature: bs58.encode(signed.signature) },
        { timeoutMs: 120_000 },
      );
      setMessage(claimMessage, "Card sent to your wallet.");
      const link = document.createElement("a");
      link.href = `https://solscan.io/tx/${result.signature}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Tx";
      button.replaceWith(link);
    } catch (error) {
      button.disabled = false;
      setMessage(claimMessage, errorText(error), true);
    }
  };
  rewards?.addEventListener("click", onClaim);

  void initialize();
  return () => {
    destroyed = true;
    rewards?.removeEventListener("click", onClaim);
    generation++;
    poller?.stop();
    treasuryPoller?.stop();
    if (countdownTimer) clearInterval(countdownTimer);
    window.removeEventListener("launchseeds:wallet", onSharedWallet);
    window.removeEventListener(
      "launchseeds:wallet-disconnected",
      onSharedDisconnected,
    );
    if (dialog.open) dialog.close();
    render(null, activeRoot);
    const bar = document.querySelector<HTMLElement>("[data-turnout-bar]");
    if (bar) render(null, bar);
    render(null, distribution);
    render(null, votesRoot);
    render(null, voteRoot);
    render(null, positionRoot);
  };
}
