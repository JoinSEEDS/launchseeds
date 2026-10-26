import { render } from "tradjs/client";
import {
  parseLaunchSettings,
  feeSplit,
  durationText,
  sniperDescription,
  secondsText,
  compactUsd,
  rangeText,
  liquidityShare,
  SNIPER_SECONDS,
  MARKET_CAP_STOPS,
  MAX_LIQUIDITY_SHARE,
  LIQUIDITY_AVAILABLE,
  type LaunchSettings,
} from "../../src/domain/launch-settings";
import { createStrategyBuilder } from "../components/strategy-builder";
import { strategySummary } from "../../lib/strategy-presenter";
import { launchAvailability } from "../../lib/launch-presentation";
import type { Catalog } from "../../lib/catalog";
import type { Strategy } from "../../lib/strategy";
import {
  getJson,
  postJson,
  patchJson,
  uploadImage,
  copyText,
  SequentialPoller,
} from "../../lib/client-request";
import { connectWallet, walletAddress } from "../../lib/wallet-session";
import { sendWalletTransaction } from "../../lib/wallet-transaction";
import { createMiner, type MineFound, type MineProgress } from "../../lib/proof-of-work";
import {
  buildLaunchPayload,
  launchUrl,
  launchView,
  publicTokenUrl,
  validateImage,
  validateLaunchFields,
  validLaunchStatus,
  type PublicLaunchStatus,
} from "../../lib/launch-ui";

type UploadResult = { image: string };
type Config = {
  launchEnabled: boolean;
  baseFeeLamports: number | null;
  message: string;
  freeLaunch?: { available: boolean; bits: number | null };
  imageGeneration?: boolean;
};

function find<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing launch component: ${id}`);
  return node as T;
}

function freshCapability(): string {
  const buffer = crypto.getRandomValues(new Uint8Array(32));
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const short = (value: string) =>
  value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;

/** Solana Pay URI: wallet apps that scan it prefill the address and amount. */
export function solanaPayUri(address: string, sol: string, symbol: string): string {
  const params = new URLSearchParams({
    amount: sol,
    label: "LaunchSeeds",
    message: `Launch $${symbol}`,
  });
  return `solana:${address}?${params.toString()}`;
}

export default function mount() {
  const foundForm = document.getElementById(
    "launch-form",
  ) as HTMLFormElement | null;
  if (!foundForm) return;
  const form: HTMLFormElement = foundForm;

  const name = find<HTMLInputElement>("f-name");
  const ticker = find<HTMLInputElement>("f-ticker");
  const dev = find<HTMLInputElement>("f-dev");
  const image = find<HTMLInputElement>("f-image");
  const website = find<HTMLInputElement>("f-web");
  const x = find<HTMLInputElement>("f-x");
  const telegram = find<HTMLInputElement>("f-tg");
  const powInput = form.querySelector<HTMLInputElement>("[data-pow]")!;
  const shareInput = form.querySelector<HTMLInputElement>("[data-share]")!;
  const lowInput = form.querySelector<HTMLInputElement>("[data-range-lo]")!;
  const highInput = form.querySelector<HTMLInputElement>("[data-range-hi]")!;
  const editDetails = find<HTMLButtonElement>("edit-launch-details");
  const payButton = find<HTMLButtonElement>("pay-in-wallet");
  const errorBox = find<HTMLElement>("launch-error");
  const readiness = find<HTMLElement>("launch-ready-hint");
  const recheck = find<HTMLButtonElement>("recheck-launch");
  const submit = find<HTMLButtonElement>("get-deposit");
  const actionWrap = find<HTMLElement>("submit-wrap");
  const previewRoot = find<HTMLElement>("launch-first-preview");
  const builderRoot = find<HTMLElement>("first-strategy-root");
  const statusPanel = find<HTMLElement>("launch-status-panel");
  const statusText = find<HTMLElement>("payment-status");
  const retryButton = find<HTMLButtonElement>("retry-launch-status");
  const avatar = find<HTMLElement>("launch-avatar");
  const imageUpload = find<HTMLElement>("image-upload");
  const feedback = find<HTMLElement>("funding-copy-feedback");
  const freeButton = find<HTMLButtonElement>("free-launch");
  const freeStatus = find<HTMLElement>("free-launch-status");
  const generateButton = find<HTMLButtonElement>("generate-image");

  // Strategy rules are not chosen on the launch form; every launch uses the
  // defaults (24h first-strategy lock, 1h minimum active). Summary shows them.
  const rules = { firstStrategyLockMs: 86_400_000, minimumActiveMs: 3_600_000 };
  let catalog: Catalog | null = null;
  let current: Strategy | null = null;
  let builder: ReturnType<typeof createStrategyBuilder> | null = null;
  let config: Config | null = null;
  let checking = true;
  let prepared: PublicLaunchStatus | null = null;
  let launchHandle = "";
  let pendingPayload = "";
  let capability = "";
  let busy = false;
  let destroyed = false;
  let pictureUrl: string | null = null;
  let poller: SequentialPoller | null = null;
  let countdown: ReturnType<typeof setInterval> | null = null;
  let latestRequest = 0;
  let editingPrepared = false;

  const symbolNow = () =>
    (ticker.value.trim() || "TOKEN").replace(/^\$/, "").toUpperCase();
  const isOn = (panel: string) =>
    form
      .querySelector(`[data-toggle-panel="${panel}"] [data-switch]`)
      ?.getAttribute("aria-checked") === "true";
  /** Reward fund only counts when its panel is switched on. */
  const rewardFund = () => (isOn("fund") ? dev.value.trim() || "0" : "0");

  function readSettings(): LaunchSettings {
    return parseLaunchSettings({
      firstStrategyLockMs: rules.firstStrategyLockMs,
      minimumActiveMs: rules.minimumActiveMs,
      sniperSeconds: isOn("pow") ? SNIPER_SECONDS[Number(powInput.value)] : null,
      liquidity: LIQUIDITY_AVAILABLE && isOn("liq")
        ? {
            feeShare: Number(shareInput.value),
            minMcapUsd: MARKET_CAP_STOPS[Number(lowInput.value)],
            maxMcapUsd: MARKET_CAP_STOPS[Number(highInput.value)],
          }
        : null,
      holderRewards: isOn("holder"),
    });
  }

  const fill = (input: HTMLInputElement, lo: number, hi: number) => {
    const slider = input.closest<HTMLElement>(".slider");
    slider?.style.setProperty("--lo", `${lo}%`);
    slider?.style.setProperty("--hi", `${hi}%`);
  };
  /** Slider readouts; the two range handles never cross. */
  function readSliders() {
    const lastPow = SNIPER_SECONDS.length - 1;
    const pow = Number(powInput.value);
    fill(powInput, 0, (pow / lastPow) * 100);
    const seconds = secondsText(SNIPER_SECONDS[pow]!);
    form.querySelector("[data-pow-out]")!.textContent = seconds;
    powInput.setAttribute("aria-valuetext", seconds);
    const share = Number(shareInput.value);
    fill(shareInput, 0, ((share - 1) / (MAX_LIQUIDITY_SHARE - 1)) * 100);
    form.querySelector("[data-share-out]")!.textContent = String(share);
    shareInput.setAttribute("aria-valuetext", `${share}%`);
    const lastStop = MARKET_CAP_STOPS.length - 1;
    let lo = Number(lowInput.value), hi = Number(highInput.value);
    if (lo >= hi) {
      if (document.activeElement === lowInput) lowInput.value = String((lo = hi - 1));
      else highInput.value = String((hi = lo + 1));
    }
    fill(lowInput, (lo / lastStop) * 100, (hi / lastStop) * 100);
    const low = compactUsd(MARKET_CAP_STOPS[lo]!), high = compactUsd(MARKET_CAP_STOPS[hi]!);
    form.querySelector("[data-range-out]")!.textContent = `${low}–${high}`;
    lowInput.setAttribute("aria-valuetext", low);
    highInput.setAttribute("aria-valuetext", high);
  }

  function showSettingsSummary() {
    const settings = readSettings();
    const rows: [string, string][] = [
      ["Strategy lock", durationText(settings.firstStrategyLockMs)],
      ["Minimum active", durationText(settings.minimumActiveMs)],
      ["Sniper protection", sniperDescription(settings)],
      ["Liquidity", settings.liquidity ? `${settings.liquidity.feeShare}% · ${rangeText(settings)}` : "Off"],
      ["Holder rewards", settings.holderRewards ? "On · public market making" : "Off"],
    ];
    render(
      <>{rows.map(([term, value]) => <><dt>{term}</dt><dd>{value}</dd></>)}</>,
      find<HTMLElement>("summary-rules"),
    );
    const split = feeSplit(liquidityShare(settings));
    const parts: [string, number, string][] = [
      ["Rewards", split.rewardsPercent, "var(--accent)"],
      ["Liquidity", split.liquidityPercent, "var(--s-burn)"],
      ["$TOKEN", split.tokenPercent, "var(--muted)"],
    ];
    const shown = parts.filter(([, pct]) => pct > 0);
    const bar = find<HTMLElement>("launch-fee-split");
    bar.setAttribute(
      "aria-label",
      `${split.tokenPercent}% to $TOKEN, ${split.liquidityPercent}% to liquidity, ${split.rewardsPercent}% to holder rewards`,
    );
    render(
      <>{shown.map(([, pct, color]) => <i style={{ width: `${pct}%`, background: color }} />)}</>,
      bar,
    );
    render(
      <>{shown.map(([label, pct, color]) => (
        <span><i style={{ background: color }} />{`${label} `}<b>{`${pct}%`}</b></span>
      ))}</>,
      find<HTMLElement>("launch-fee-legend"),
    );
  }

  const showError = (message: string) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };
  const clearError = () => {
    errorBox.textContent = "";
    errorBox.hidden = true;
  };
  const stopTimers = () => {
    poller?.stop();
    poller = null;
    if (countdown) clearInterval(countdown);
    countdown = null;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    updateAvailability();
    submit.setAttribute("aria-busy", String(value));
  };

  function updateAvailability() {
    const view = launchAvailability(config, rewardFund(), {
      checking,
      busy,
      connected: false,
    });
    submit.disabled = view.disabled;
    submit.textContent = editingPrepared ? "Confirm changes" : view.buttonLabel;
    actionWrap.hidden = !view.showAction;
    readiness.hidden = !view.showUnavailable;
    readiness.textContent = view.message;
    recheck.hidden = checking || config?.launchEnabled === true || !!prepared;
    recheck.disabled = checking || busy;
    find<HTMLElement>("summary-fee").textContent = view.fee;
    find<HTMLElement>("summary-total").textContent = view.total;
  }

  /** Keep the same direct render pattern; only the summary is client-owned. */
  const sync = () => {
    const symbol = symbolNow();
    find<HTMLElement>("summary-name").textContent =
      name.value.trim() || "Untitled";
    find<HTMLElement>("summary-ticker").textContent = `$${symbol}`;
    if (!avatar.querySelector("img")) {
      avatar.textContent = (name.value.trim() || "T")
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || "")
        .join("")
        .toUpperCase();
    }
    find<HTMLElement>("summary-dev").textContent = rewardFund();
    find<HTMLElement>("reward-fund-ticker").textContent = `$${symbol}`;
    updateAvailability();
    try { readSliders(); showSettingsSummary(); } catch { /* Invalid setting is reported on submit. */ }
    form.querySelectorAll<HTMLButtonElement>("[data-dev]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.dev) === Number(dev.value)),
      );
    });
    const description = current ? strategySummary(current, catalog) : null;
    render(
      description ? (
        <div className="strategy-preview">
          <strong className="strategy-preview__name">
            {description.title}
          </strong>
          <span className="strategy-preview__detail">{description.detail}</span>
        </div>
      ) : (
        <span className="muted">Choose a starting strategy</span>
      ),
      previewRoot,
    );
  };

  function showImage(file: File) {
    if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    pictureUrl = URL.createObjectURL(file);
    const small = document.createElement("img");
    small.src = pictureUrl;
    small.alt = "Selected token artwork";
    small.className = "avatar-image";
    avatar.replaceChildren(small);
    imageUpload.querySelector("img")?.remove();
    const large = small.cloneNode() as HTMLImageElement;
    large.alt = "Token image preview";
    imageUpload.prepend(large);
    clearError();
  }

  image.addEventListener("change", () => {
    const file = image.files?.[0] || null;
    const reason = validateImage(file);
    if (reason) {
      if (file) image.value = "";
      showError(reason);
      return;
    }
    showImage(file!);
  });
  generateButton.addEventListener("click", async () => {
    if (generateButton.disabled) return;
    if (!name.value.trim()) {
      showError("Enter a token name first, then generate an image.");
      name.focus();
      return;
    }
    generateButton.disabled = true;
    generateButton.classList.add("is-busy");
    generateButton.textContent = "Generating…";
    imageUpload.classList.add("is-generating");
    clearError();
    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.value, symbol: ticker.value }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "Image generation failed.");
      }
      const blob = await response.blob();
      const file = new File([blob], `${ticker.value.trim() || "token"}.png`, { type: "image/png" });
      // Same path as a picked file: validation, preview and upload at submit.
      const transfer = new DataTransfer();
      transfer.items.add(file);
      image.files = transfer.files;
      image.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) {
      showError(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      generateButton.disabled = false;
      generateButton.classList.remove("is-busy");
      generateButton.textContent = "Generate";
      imageUpload.classList.remove("is-generating");
    }
  });

  const onDetailChanged = (event: Event) => {
    if (!(event.target as HTMLElement).closest("#first-strategy-root")) sync();
  };
  form.addEventListener("input", onDetailChanged);
  form.addEventListener("change", onDetailChanged);
  form.querySelectorAll<HTMLButtonElement>("[data-dev]").forEach((button) => {
    button.addEventListener("click", () => {
      dev.value = button.dataset.dev || "0";
      sync();
    });
  });
  // On/off panels.
  form.querySelectorAll<HTMLElement>("[data-toggle-panel]").forEach((panel) => {
    const toggle = panel.querySelector<HTMLButtonElement>("[data-switch]")!;
    const apply = () =>
      panel.classList.toggle("is-off", toggle.getAttribute("aria-checked") !== "true");
    toggle.addEventListener("click", () => {
      toggle.setAttribute("aria-checked", String(toggle.getAttribute("aria-checked") !== "true"));
      apply();
      sync();
    });
    apply();
  });

  editDetails.addEventListener("click", () => {
    if (!prepared || prepared.receivedLamports > 0 || prepared.status !== "funding") return;
    editingPrepared = true;
    stopTimers();
    statusPanel.hidden = true;
    form.hidden = false;
    find<HTMLElement>("submit-wrap").hidden = false;
    actionWrap.hidden = false;
    submit.textContent = "Confirm changes";
    find<HTMLElement>("step-details").className = "is-current";
    find<HTMLElement>("step-deposit").className = "";
    clearError();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  payButton.addEventListener("click", async () => {
    if (!prepared || !launchHandle || !capability) return;
    feedback.textContent = "";
    payButton.disabled = true;
    try {
      const wallet = walletAddress() || (await connectWallet());
      payButton.textContent = "Check your wallet…";
      const built = await postJson<{ transaction: string }>(
        "/api/launch-payment",
        { handle: launchHandle, wallet },
        { headers: { authorization: `Bearer ${capability}` }, timeoutMs: 20_000 },
      );
      await sendWalletTransaction(built.transaction);
      feedback.textContent = "Payment sent. Waiting for the network to confirm it.";
      void requestStatus().catch(() => {});
    } catch {
      feedback.textContent =
        "Payment wasn't sent. Try again, or send from any wallet using the address.";
    } finally {
      payButton.disabled = false;
      payButton.textContent = "Pay in Wallet";
    }
  });

  let freeConfig: Promise<Config | null> | null = null;
  const loadFreeConfig = () =>
    (freeConfig ??= config
      ? Promise.resolve(config)
      : getJson<Config>("/api/launch-config").catch(() => null));
  let freeRunning = false;
  /** Free Launch shows for an unpaid launch without a dev buy while the treasury has funds. */
  function paintFreeLaunch(status: PublicLaunchStatus) {
    const eligible =
      Boolean(capability) &&
      launchView(status).canFund &&
      status.receivedLamports === 0 &&
      (status.devBuyLamports ?? 0) === 0;
    if (!eligible) {
      // Paid some other way while mining: stop and put the panel away.
      if (puzzle && !mineFound) resetMine();
      freeButton.hidden = true;
      return;
    }
    void loadFreeConfig().then((loaded) => {
      if (!freeRunning) freeButton.hidden = !eligible || !loaded?.freeLaunch?.available;
    });
  }

  const mine = {
    panel: find<HTMLElement>("mine"),
    title: find<HTMLElement>("mine-title"),
    sub: find<HTMLElement>("mine-sub"),
    start: find<HTMLButtonElement>("mine-start"),
    stop: find<HTMLButtonElement>("mine-stop"),
    stats: find<HTMLElement>("mine-stats"),
    rows: find<HTMLElement>("mine-rows"),
    bar: find<HTMLElement>("mine-bar"),
    work: find<HTMLElement>("mine-work"),
    best: find<HTMLElement>("mine-best"),
  };
  let miner: ReturnType<typeof createMiner> | null = null;
  let mineFound = false; // a proof was found: keep the panel showing the claim result
  let puzzle: { challenge: string; bits: number; expiresAt: number; poolLamports: number | null } | null = null;
  const freeAuth = () => ({ headers: { authorization: `Bearer ${capability}` }, timeoutMs: 20_000 });
  const clock = (sec: number) => {
    sec = Math.max(0, Math.round(sec));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const big = (n: number) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
  const mineText = (title: string, sub: string, tone?: "ok" | "error") => {
    mine.title.textContent = title;
    mine.title.classList.toggle("is-ok", tone === "ok");
    mine.title.classList.toggle("is-error", tone === "error");
    mine.sub.textContent = sub;
  };
  const showMineDetail = (on: boolean) => {
    for (const el of [mine.stats, mine.rows, mine.bar]) el.hidden = !on;
  };
  function resetMine() {
    miner?.stop();
    miner = null;
    mineFound = false;
    puzzle = null;
    freeRunning = false;
    mine.panel.hidden = true;
    mine.start.hidden = false;
    mine.start.disabled = false;
    mine.start.textContent = "Start Mining";
    mine.stop.hidden = true;
    mine.best.classList.remove("is-ok");
    mine.work.parentElement!.classList.remove("is-ok");
    showMineDetail(false);
  }

  freeButton.addEventListener("click", async () => {
    if (!prepared || !launchHandle || !capability || freeRunning) return;
    freeRunning = true;
    freeButton.classList.add("is-busy");
    freeStatus.hidden = true;
    freeStatus.classList.remove("is-error");
    try {
      puzzle = await postJson("/api/free-launch", { action: "challenge", handle: launchHandle }, freeAuth());
    } catch (error) {
      freeRunning = false;
      freeStatus.hidden = false;
      freeStatus.classList.add("is-error");
      freeStatus.textContent = error instanceof Error ? error.message : "Free launch is not available. You can still pay.";
      return;
    } finally {
      freeButton.classList.remove("is-busy");
    }
    freeButton.hidden = true;
    mine.panel.hidden = false;
    mineText(
      "Mine a free launch",
      "Your browser hashes until it finds one below the target. Usually a few seconds on a laptop, longer on a phone, sooner if you're lucky. Up to 3 free launches per day.",
    );
    const zeros = Math.floor(puzzle!.bits / 4);
    find<HTMLElement>("mine-target").textContent = "0".repeat(zeros) + "f".repeat(64 - zeros);
    find<HTMLElement>("mine-pool").textContent =
      puzzle!.poolLamports == null ? "—" : `${(puzzle!.poolLamports / 1e9).toFixed(2)} SOL`;
    mine.start.focus();
  });

  mine.start.addEventListener("click", () => {
    if (!puzzle) return;
    if (puzzle.expiresAt <= Date.now()) {
      resetMine();
      freeButton.hidden = false;
      freeStatus.hidden = false;
      freeStatus.textContent = "The puzzle expired. Press Mine Free Launch to get a new one.";
      return;
    }
    miner ??= createMiner({ seed: puzzle.challenge, bits: puzzle.bits }, { onProgress: progress, onFound: found });
    showMineDetail(true);
    mineText("Mining…", "Keep this tab open. You can still pay at any time.");
    mine.start.hidden = true;
    mine.stop.hidden = false;
    miner.start();
  });

  mine.stop.addEventListener("click", () => {
    miner?.stop();
    mine.stop.hidden = true;
    mine.start.hidden = false;
    mine.start.textContent = "Resume";
    mineText("Mining stopped", "Resume any time. Work done so far is kept.");
    find<HTMLElement>("mine-speed").textContent = "—";
  });

  function progress(p: MineProgress) {
    const expected = 2 ** puzzle!.bits;
    const pct = Math.min(100, (p.hashes / expected) * 100);
    find<HTMLElement>("mine-speed").textContent =
      !p.speed ? "…" : p.speed >= 1e6 ? `${(p.speed / 1e6).toFixed(2)} MH/s` : `${Math.round(p.speed / 1e3)} kH/s`;
    find<HTMLElement>("mine-hashes").textContent = big(p.hashes);
    find<HTMLElement>("mine-time").textContent = clock(p.seconds);
    find<HTMLElement>("mine-expected").textContent = p.speed ? `~${clock(expected / p.speed)}` : "…";
    if (p.bestHex) mine.best.textContent = p.bestHex;
    if (p.now) find<HTMLElement>("mine-now").textContent = p.now;
    mine.work.style.width = `${pct.toFixed(1)}%`;
    mine.work.parentElement!.setAttribute("aria-valuenow", String(Math.round(pct)));
    find<HTMLElement>("mine-work-text").textContent = `${Math.round((p.hashes / expected) * 100)}% of expected work`;
  }

  async function found(f: MineFound) {
    mineFound = true;
    mine.stop.hidden = true;
    mine.start.hidden = true;
    mine.best.textContent = f.hash;
    mine.best.classList.add("is-ok");
    mine.work.style.width = "100%";
    mine.work.parentElement!.classList.add("is-ok");
    find<HTMLElement>("mine-work-text").textContent = `Found after ${big(f.hashes)} hashes in ${clock(f.seconds)}`;
    mineText("Found it. Checking…", "Sending your answer to be verified.");
    try {
      await postJson<{ signature: string }>(
        "/api/free-launch",
        { action: "claim", handle: launchHandle, challenge: puzzle!.challenge, nonce: String(f.nonce) },
        freeAuth(),
      );
      mineText("Found it. Your launch is free.", "The launch fee was sent from the free launch pool. Launching once the network confirms it.", "ok");
      payButton.hidden = true;
      void requestStatus().catch(() => {});
    } catch (error) {
      mineText("That answer was not accepted", error instanceof Error ? error.message : "Try again, or pay in wallet.", "error");
      miner = null;
      puzzle = null;
      mineFound = false;
      freeRunning = false;
      freeButton.hidden = false;
    }
  }

  /** The quote window. Payments after it are still detected and processed,
   * so the countdown simply disappears instead of claiming the address expired. */
  function startCountdown(expiresAt: number | undefined) {
    if (countdown) clearInterval(countdown);
    countdown = null;
    const expiry = find<HTMLElement>("payment-expiry");
    expiry.hidden = !expiresAt || expiresAt <= Date.now();
    if (expiry.hidden) return;
    const out = find<HTMLElement>("payment-expires");
    const tick = () => {
      const left = Math.max(0, Math.round((expiresAt! - Date.now()) / 1000));
      out.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      if (left === 0 && countdown) {
        clearInterval(countdown);
        countdown = null;
        expiry.hidden = true;
      }
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  function showStatus(status: PublicLaunchStatus) {
    if (destroyed) return;
    prepared = status;
    launchHandle = status.handle;
    // Public launch status also supplies the token identity on a direct
    // /launch?launch=… visit. Never leave the designer's sample $SLAB label.
    const symbol = status.symbol.replace(/^\$/, "").toUpperCase();
    find<HTMLElement>("summary-ticker").textContent = `$${symbol}`;
    find<HTMLElement>("summary-name").textContent = status.name;
    statusPanel.querySelectorAll<HTMLElement>("[data-bind-ticker]").forEach((label) => {
      label.textContent = `$${symbol}`;
    });
    const link = launchUrl(status.handle);
    if (link && location.pathname + location.search !== link) {
      history.replaceState(null, "", link);
    }
    const view = launchView(status);
    const live = view.phase === "live";
    const fundAmount = (status.devBuyLamports ?? 0) / 1e9;
    // Checklist ticks off one by one: payment → token → treasury → rules → fund.
    const steps = Array.from(
      document.querySelectorAll<HTMLElement>("#launch-checklist li"),
    );
    const fundStep = find<HTMLElement>("dev-buy-step");
    fundStep.hidden = fundAmount === 0;
    const visible = steps.filter((step) => !step.hidden);
    const completed = live
      ? visible.length - (fundAmount > 0 && !status.rewardFundVerified ? 1 : 0)
      : view.phase === "deploying"
        ? 1
        : 0;
    find<HTMLElement>("step-token").textContent = live ? "Token created"
      : status.launchSignature ? "Confirming token" : "Creating token";
    visible.forEach((step, index) => {
      step.classList.toggle("is-done", index < completed);
      step.classList.toggle("is-current", index === completed && view.phase !== "failed");
    });
    find<HTMLElement>("step-payment").firstChild!.textContent =
      view.phase === "funding" ? "Waiting for payment" : "Payment received";
    find<HTMLElement>("reward-fund-amount").textContent =
      `${fundAmount.toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;
    if (live && fundAmount > 0 && !status.rewardFundVerified)
      fundStep.title = "Awaiting a confirmed treasury token-balance observation";

    statusPanel.hidden = false;
    form.hidden = true;
    find<HTMLElement>("submit-wrap").hidden = true;
    find<HTMLElement>("step-details").className = "is-done";
    find<HTMLElement>("step-deposit").className = live ? "is-done" : "is-current";
    find<HTMLElement>("step-live").className = live ? "is-done" : "";
    for (const [id, done, number] of [["step-details", true, "1"], ["step-deposit", live, "2"], ["step-live", live, "3"]] as const) {
      const marker = find<HTMLElement>(id).querySelector("span");
      if (marker) marker.textContent = done ? "✓" : number;
    }
    editingPrepared = false;
    editDetails.hidden = view.phase !== "funding" || status.receivedLamports > 0 || !capability;
    payButton.hidden = !view.canFund || !capability;
    paintFreeLaunch(status);
    find<HTMLElement>("pay-title").textContent = live ? "Launched" : view.canFund ? "Pay to launch" : "Launching";
    // Moving bar and spinner while preparing, waiting for payment or deploying.
    find<HTMLElement>("launch-busy").hidden = !view.waiting;
    find<HTMLElement>("launch-scan").hidden = !view.waiting;
    find<HTMLElement>("launch-busy-text").textContent =
      view.canFund ? "Waiting for payment" : view.phase === "preparing" ? "Preparing" : status.launchSignature ? "Confirming transaction" : "Launching";
    statusText.textContent = view.canFund
      ? `${view.receivedSol} SOL received so far.`
      : view.message;
    statusText.hidden = live;

    find<HTMLElement>("payment-amount").textContent = view.canFund
      ? `${view.requiredSol} SOL`
      : "—";
    find<HTMLElement>("funding-details").hidden = !view.showAddress;
    const address = find<HTMLElement>("payment-address");
    const copy = find<HTMLButtonElement>("copy-address");
    const amountCopy = find<HTMLButtonElement>("copy-amount");
    amountCopy.onclick = async () => {
      const ok = await copyText(view.requiredSol);
      feedback.textContent = ok ? "Exact SOL amount copied." : "Select the amount to copy.";
    };
    const qr = find<HTMLImageElement>("payment-qr");
    if (view.showAddress) {
      address.textContent = status.fundingWallet;
      copy.onclick = async () => {
        const ok = await copyText(status.fundingWallet);
        feedback.textContent = ok ? "Address copied." : "Select the address to copy.";
      };
      const uri = solanaPayUri(status.fundingWallet, view.requiredSol, symbol);
      if (qr.dataset.uri !== uri) {
        qr.dataset.uri = uri;
        qr.hidden = true;
        void import("qrcode")
          .then(({ default: QRCode }) =>
            QRCode.toDataURL(uri, { width: 200, margin: 1, errorCorrectionLevel: "M" }),
          )
          .then((source) => {
            if (qr.dataset.uri === uri && !destroyed) {
              qr.src = source;
              qr.hidden = false;
            }
          })
          .catch(() => {
            qr.hidden = true;
          });
      }
      startCountdown(status.expiresAt);
    } else {
      address.textContent = "";
      qr.removeAttribute("src");
      qr.dataset.uri = "";
      if (countdown) clearInterval(countdown);
      countdown = null;
    }

    const progress = find<HTMLElement>("deposit-progress");
    progress.setAttribute("aria-valuenow", String(Math.floor(view.progress)));
    const bar = progress.querySelector<HTMLElement>("i");
    if (bar) bar.style.width = `${view.progress}%`;
    progress.hidden = !view.canFund || view.progress === 0;

    // "$TICKER is live" card with Share on X and Open.
    const liveCard = find<HTMLElement>("launch-live");
    const url = publicTokenUrl(status.mint);
    liveCard.hidden = !live || !url;
    if (live && url) {
      find<HTMLAnchorElement>("launched-token-link").href = url;
      find<HTMLElement>("live-ca").textContent = short(status.mint);
      find<HTMLElement>("live-ca-copy").dataset.copy = status.mint;
      const liveAvatar = find<HTMLElement>("live-avatar");
      const art = avatar.querySelector("img");
      if (art) liveAvatar.replaceChildren(art.cloneNode());
      else liveAvatar.textContent = avatar.textContent;
      const text = `$${symbol} is live on LaunchSeeds. Holders vote on what its fees pay for.`;
      find<HTMLAnchorElement>("share-on-x").href =
        `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + url)}`;
    }
    retryButton.hidden = view.phase !== "failed";
    if (view.isComplete) stopTimers();
  }

  async function requestStatus(signal?: AbortSignal) {
    if (!launchHandle) return;
    const sequence = ++latestRequest;
    const status = await getJson<PublicLaunchStatus>(
      `/api/launches/${encodeURIComponent(launchHandle)}`,
      { signal, timeoutMs: 12_000 },
    );
    if (!validLaunchStatus(status))
      throw new Error("Launch status response was incomplete.");
    if (destroyed || sequence !== latestRequest) return;
    showStatus(status);
  }

  function startPolling() {
    poller?.stop();
    poller = new SequentialPoller(requestStatus, 2_000, (error) => {
      if (!destroyed)
        statusText.textContent =
          error instanceof Error
            ? `${error.message} Funding status will be checked again.`
            : "Funding status temporarily unavailable.";
    });
    poller.start();
  }

  retryButton.addEventListener("click", async () => {
    retryButton.disabled = true;
    try {
      await requestStatus();
    } catch (error) {
      statusText.textContent =
        error instanceof Error ? error.message : "Status unavailable.";
    } finally {
      retryButton.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || (prepared && !editingPrepared)) return;
    clearError();
    if (!config?.launchEnabled) {
      // Offline launch state is already shown in place of the CTA.
      return;
    }
    if (!builder) {
      showError("Strategy choices are loading.");
      return;
    }
    const result = builder.get();
    if ("error" in result) {
      showError(result.error || "Choose a valid starting strategy.");
      return;
    }
    const file = image.files?.[0] || null;
    const imageProblem = validateImage(file);
    if (imageProblem) {
      showError(imageProblem);
      return;
    }
    let settings: LaunchSettings;
    try { settings = readSettings(); }
    catch (error) {
      showError(error instanceof Error ? error.message : "Enter valid launch settings.");
      return;
    }
    const formFields = {
      name: name.value,
      symbol: ticker.value,
      devBuySol: rewardFund(),
      website: website.value,
      x: x.value,
      telegram: telegram.value,
      image: "",
      firstStrategy: result.config,
      settings,
    };
    const validation = validateLaunchFields(formFields);
    if (validation) {
      showError(validation);
      return;
    }

    setBusy(true);
    try {
      // Prepare a funding address without connecting or signing in a wallet.
      const uploaded = await uploadImage<UploadResult>("/api/media", file!);
      if (!uploaded.image)
        throw new Error("Image hosting did not return a URL.");
      const payload = JSON.stringify(
        buildLaunchPayload({ ...formFields, image: uploaded.image }),
      );
      if (editingPrepared && prepared) {
        if (payload === pendingPayload) {
          showStatus(prepared);
          startPolling();
          return;
        }
        const amended = await patchJson<PublicLaunchStatus>(
          `/api/launches/${encodeURIComponent(prepared.handle)}`,
          JSON.parse(payload),
          {
            headers: { authorization: `Bearer ${capability}` },
            timeoutMs: 90_000,
          },
        );
        if (!validLaunchStatus(amended) ||
            amended.handle !== prepared.handle ||
            amended.fundingWallet !== prepared.fundingWallet) {
          throw new Error("Amendment did not preserve the funding address.");
        }
        pendingPayload = payload;
        showStatus(amended);
        startPolling();
        return;
      }
      if (payload !== pendingPayload) {
        pendingPayload = payload;
        capability = freshCapability();
      }
      // This is an idempotency key for the in-flight request, NOT a user edit
      // link. No draft keys are persisted in localStorage or the URL.
      const response = await postJson<PublicLaunchStatus>(
        "/api/launches",
        JSON.parse(payload),
        {
          headers: { authorization: `Bearer ${capability}` },
          timeoutMs: 30_000,
        },
      );
      if (!validLaunchStatus(response))
        throw new Error("Launch preparation response was incomplete.");
      showStatus(response);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (!launchView(response).isComplete) startPolling();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to prepare launch.",
      );
    } finally {
      setBusy(false);
    }
  });

  // Prepared launch details remain in the existing form. Never silently
  // create another funding address when a user navigates back to review.

  async function initialise() {
    // `uid` is the pre-2026-10-25 parameter name; old creator links keep working.
    const query = new URLSearchParams(location.search);
    const existing = query.get("launch") || query.get("uid");
    if (existing) {
      checking = false;
      readiness.hidden = true;
      actionWrap.hidden = true;
      const link = launchUrl(existing);
      if (!link) {
        showError("Invalid launch URL.");
        return;
      }
      launchHandle = existing;
      statusPanel.hidden = false;
      form.hidden = true;
      find<HTMLElement>("submit-wrap").hidden = true;
      try {
        await requestStatus();
        if (!destroyed && prepared && !launchView(prepared).isComplete)
          startPolling();
      } catch (error) {
        statusText.textContent =
          error instanceof Error
            ? error.message
            : "Unable to load launch status.";
        retryButton.hidden = false;
      }
      return;
    }

    const [catalogResult, configResult] = await Promise.allSettled([
      getJson<Catalog>("/api/catalog"),
      getJson<Config>("/api/launch-config"),
    ]);
    if (destroyed) return;
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
    config =
      configResult.status === "fulfilled"
        ? configResult.value
        : {
            launchEnabled: false,
            baseFeeLamports: null,
            message: "Launch status unavailable.",
          };
    generateButton.hidden = !config.imageGeneration;
    mountBuilder();
    checking = false;
    // The upstream catalogue can be unavailable without disabling burn or
    // wallet strategies. The strategy builder validates each selection.
    sync();
  }

  /** A launch starts with a pack or a stock; a holder-reward launch starts with its
   * market-making rules. Holders can vote for others later. */
  function mountBuilder() {
    if (!catalog) return;
    current = null;
    builder = createStrategyBuilder(builderRoot, {
      catalog,
      // Profits from the sell plan buy packs or stocks like any coin's treasury.
      tabs: ["pack", "stock"],
      onChange: (next) => {
        current = next;
        sync();
      },
    });
  }
  form.querySelector('[data-toggle-panel="holder"] [data-switch]')?.addEventListener("click", () => {
    mountBuilder();
    sync();
  });

  async function refreshReadiness() {
    if (destroyed || checking || busy || prepared) return;
    checking = true;
    updateAvailability();
    try {
      const latest = await getJson<Config>("/api/launch-config");
      if (destroyed) return;
      config = latest;
      freeConfig = Promise.resolve(latest);
      if (latest.launchEnabled) clearError();
    } catch {
      if (!destroyed) config = { launchEnabled: false, baseFeeLamports: config?.baseFeeLamports ?? null, message: "" };
    } finally {
      if (!destroyed) { checking = false; updateAvailability(); }
    }
  }
  const onReturn = () => { if (!document.hidden) void refreshReadiness(); };
  recheck.addEventListener("click", refreshReadiness);
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  sync();
  void initialise().catch(() => {
    if (destroyed) return;
    checking = false;
    config = { launchEnabled: false, baseFeeLamports: null, message: "" };
    updateAvailability();
  });
  return () => {
    destroyed = true;
    recheck.removeEventListener("click", refreshReadiness);
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
    miner?.stop();
    latestRequest++;
    stopTimers();
    if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    render(null, previewRoot);
    render(null, builderRoot);
    render(null, find<HTMLElement>("summary-rules"));
    render(null, find<HTMLElement>("launch-fee-split"));
    render(null, find<HTMLElement>("launch-fee-legend"));
  };
}
