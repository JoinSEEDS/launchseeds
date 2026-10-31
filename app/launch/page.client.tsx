import { normalizeX, telegramLink, xLink } from "../../lib/launch-socials";
import { allocateUserBatches } from "../../src/domain/user-funded-batches";
import { mountLaunchColumns } from "../../lib/launch-columns";
import { mountLaunchCountdown } from "../../lib/launch-countdown";
import { allocatedBudget } from "../../src/domain/protection-allocation";
import { render } from "tradjs/client";
import {
  protectionOptions,
  PROTECTION_BUDGET_MAX_AGE,
} from "../../lib/protection-options";
import {
  parseLaunchSettings,
  BUNDLE_STOPS_SOL,
  BUNDLE_DEFAULT_EXIT_PERCENT,
  bundleFeeLamports,
  type LaunchSettings,
} from "../../src/domain/launch-settings";
import { launchAvailability } from "../../lib/launch-presentation";
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
import {
  createMiner,
  type MineFound,
  type MineProgress,
} from "../../lib/proof-of-work";
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
  /** Sniper protection (LaunchSeeds-funded launch bundle) is available. */
  sniperBundles?: boolean;
  userFundedBatches?: boolean;
  protectionBudget?: { maxLamports: number; checkedAt: number; fresh: boolean };
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
export function solanaPayUri(
  address: string,
  sol: string,
  symbol: string,
): string {
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
  const image = find<HTMLInputElement>("f-image");
  const website = find<HTMLInputElement>("f-web");
  const x = find<HTMLInputElement>("f-x");
  const telegram = find<HTMLInputElement>("f-tg");
  const bundleInput = find<HTMLInputElement>("f-bundle");
  const descriptionInput = find<HTMLTextAreaElement>("f-desc");
  const websiteOwn = find<HTMLInputElement>("f-web-own");
  const descriptionOwn = find<HTMLInputElement>("f-desc-own");
  const cloneInput = find<HTMLInputElement>("f-clone");
  const cloneButton = find<HTMLButtonElement>("clone-btn");
  const cloneStatus = find<HTMLElement>("clone-status");
  const cloneResult = find<HTMLElement>("clone-result");
  const cloneDialog = find<HTMLDialogElement>("clone-dialog");
  const openClone = find<HTMLButtonElement>("open-clone");
  const editDetails = find<HTMLButtonElement>("edit-launch-details");
  const payButton = find<HTMLButtonElement>("pay-in-wallet");
  const errorBox = find<HTMLElement>("launch-error");
  const readiness = find<HTMLElement>("launch-ready-hint");
  const recheck = find<HTMLButtonElement>("recheck-launch");
  const submit = find<HTMLButtonElement>("get-deposit");
  const actionWrap = find<HTMLElement>("submit-wrap");
  const statusPanel = find<HTMLElement>("launch-status-panel");
  const statusText = find<HTMLElement>("payment-status");
  const retryButton = find<HTMLButtonElement>("retry-launch-status");
  const avatar = find<HTMLElement>("launch-avatar");
  const scheduledAtInput = find<HTMLInputElement>("f-scheduled-at");
  const timeMode = find<HTMLSelectElement>("f-time-mode");
  const launchMinutes = find<HTMLInputElement>("f-launch-minutes");
  const stopLaunchCountdown = mountLaunchCountdown(document.querySelector("main[data-launch]") ?? document);
  const timeModeChanged = () => {
    find<HTMLElement>("launch-minutes-field").hidden = timeMode.value !== "minutes";
    find<HTMLElement>("launch-date-field").hidden = timeMode.value !== "date";
  };
  timeMode.addEventListener("change",timeModeChanged);
  const profitMode = find<HTMLSelectElement>("f-profit-mode");
  const feeMode = find<HTMLSelectElement>("f-fee-mode");
  const feesTo = find<HTMLInputElement>("f-fees-to");
  const profitWallet = find<HTMLInputElement>("f-profit-wallet");
  const boostMinutes = find<HTMLInputElement>("f-boost-minutes");
  const boostSteps = find<HTMLInputElement>("f-boost-steps");
  const sharesInputs = [0, 1, 2].map((i) =>
    find<HTMLInputElement>(`f-wallet-share-${i}`),
  );
  // User-funded launches: up to four columns, each one bundle transaction.
  const launchColumns = mountLaunchColumns(find<HTMLElement>("user-batch-controls"), () => sync());
  const scheduledNow = () => {
    const minutes = Number(launchMinutes.value);
    return timeMode.value === "minutes" && Number.isInteger(minutes) && minutes >= 3 && minutes <= 10080 ? Date.now() + minutes * 60_000 : new Date(scheduledAtInput.value).getTime();
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = new Date(Date.now() + 30 * 60_000);
  scheduledAtInput.value = new Date(
    localTime.getTime() - localTime.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  find<HTMLElement>("schedule-timezone").textContent =
    `Times are entered in ${timezone}. The public plan records UTC.`;
  const imageUpload = find<HTMLElement>("image-upload");
  const feedback = find<HTMLElement>("funding-copy-feedback");
  const freeButton = find<HTMLButtonElement>("free-launch");
  const freeStatus = find<HTMLElement>("free-launch-status");
  const generateButton = find<HTMLButtonElement>("generate-image");

  // Strategy rules are not chosen on the launch form; every launch uses the
  // defaults (24h first-strategy lock, 1h minimum active). Summary shows them.
  const rules = { firstStrategyLockMs: 86_400_000, minimumActiveMs: 3_600_000 };
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
  const userFunded = () => config?.userFundedBatches === true && (!prepared || !!prepared.settings?.userBatches);
  /** Sniper protection: the bundle size, when available and switched on. A
   * user-funded launch buys exactly what its columns' slots add up to. */
  const bundleLamports = () => userFunded() ? (launchColumns.read(scheduledNow()).totalLamports || null) :
    config?.sniperBundles === true &&
    (userFunded() || (config.protectionBudget?.fresh === true &&
    Date.now() - config.protectionBudget.checkedAt <=
      PROTECTION_BUDGET_MAX_AGE)) &&
    isOn("bundle") &&
    !bundleInput.disabled
      ? Math.round(BUNDLE_STOPS_SOL[Number(bundleInput.value)]! * 1e9)
      : null;
  function applyProtectionBudget() {
    const panel = find<HTMLElement>("sniper-protection");
    // Columns set a user-funded launch's buys; the slider and shares are for protection buys.
    panel.hidden = config?.sniperBundles !== true || userFunded();
    const observedLimit =
      config?.protectionBudget?.fresh &&
      Date.now() - config.protectionBudget.checkedAt <=
        PROTECTION_BUDGET_MAX_AGE
        ? config.protectionBudget.maxLamports
        : 0;
    const limit = Math.max(
      userFunded() ? 5_000_000_000 : observedLimit,
      editingPrepared ? (prepared?.settings?.bundleLamports ?? 0) : 0,
    );
    const options = protectionOptions(limit, Number(bundleInput.value));
    const toggle = panel.querySelector<HTMLButtonElement>("[data-switch]")!;
    if (options.available) {
      bundleInput.max = String(options.maxIndex);
      bundleInput.value = String(options.selectedIndex);
    }
    bundleInput.disabled = toggle.disabled = !options.available;
    // A temporary capacity observation must not change the user's selection.
    // Scheduled launches hide the switch, so switching off here stranded them.
    find<HTMLElement>("user-batch-controls").hidden = !userFunded();
    find<HTMLElement>("profit-controls").hidden = userFunded();
    find<HTMLElement>("legacy-exit-controls").hidden = userFunded();
    find<HTMLElement>("bundle-how").closest("details")!.hidden = userFunded();
    find<HTMLElement>("t-bundle").textContent = userFunded() ? "02 / Fully funded launch buys" : "02 / Protection buy";
    find<HTMLElement>("bundle-capacity").textContent = userFunded() ? "You fund the selected buys and execution reserves in full. This does not depend on LaunchSeeds's capital balance." : options.available
      ? `Protection available up to ${options.stops.at(-1)} SOL. The budget refreshes as earlier positions sell.`
      : "Waiting for available protection funds. Checking automatically.";
    const ticks = find<HTMLElement>("bundle-ticks");
    ticks.replaceChildren(
      ...options.stops.map((sol) => {
        const node = document.createElement("span");
        node.textContent = String(sol);
        return node;
      }),
    );
    readSliders();
  }
  /** Reward fund only counts when its panel is on (not with sniper protection). */
  const rewardFund = () => "0";
  /** What the launcher sends beyond the base fee: reward fund + sniper-protection fee. */
  const extraSol = () => {
    const fund = Math.round(Number(rewardFund()) * 1e9) || 0;
    if(userFunded()) {
      const count=launchColumns.read(scheduledNow()).wallets;
      return String(((bundleLamports() ?? 0)+count*14_000_000+100_000)/1e9);
    }
    return (
      ((fund + bundleFeeLamports(bundleLamports())) / 1e9)
        .toFixed(9)
        .replace(/\.?0+$/, "") || "0"
    );
  };

  /** The pressed chip's value in a chip group. */
  const pressed = (attribute: string) =>
    form
      .querySelector<HTMLElement>(`[${attribute}][aria-pressed="true"]`)
      ?.getAttribute(attribute) ?? "";
  const exitPercent = () =>
    Number(pressed("data-exit")) || BUNDLE_DEFAULT_EXIT_PERCENT;

  /** `strict`: a missing or invalid fee address is an error (on submit); the
   * live summary reads it as not yet chosen. */
  function readSettings(strict = true): LaunchSettings {
    const minutes = Number(launchMinutes.value);
    if (strict && timeMode.value === "minutes" && (!Number.isInteger(minutes) || minutes < 3 || minutes > 10080)) throw new Error("Choose 3–10080 minutes from now.");
    const scheduledAt = timeMode.value === "minutes" && Number.isInteger(minutes) && minutes >= 3 && minutes <= 10080 ? Date.now() + minutes * 60_000 : new Date(scheduledAtInput.value).getTime();
    const shares = sharesInputs.map((i) => Math.round(Number(i.value) * 100));
    const amount = bundleLamports();
    const columnRead = launchColumns.read(scheduledAt);
    if (userFunded() && strict && columnRead.error) throw new Error(columnRead.error);
    const batches = userFunded() ? columnRead.value : null;
    const feeReady = feeMode.value === "holders" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(feesTo.value.trim());
    if (strict && !feeReady) throw new Error("Enter a valid creator-fee wallet address.");
    const walletReady = userFunded() ? batches !== null :
      profitMode.value !== "wallet" ||
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(profitWallet.value.trim());
    const boostDuration = Number(boostMinutes.value) * 60_000;
    const boostCount = Number(boostSteps.value);
    const boostReady = userFunded() || profitMode.value === "wallet" || (Number.isSafeInteger(boostDuration) && boostDuration >= 60_000 && boostDuration <= 30 * 86_400_000 && Number.isInteger(boostCount) && boostCount >= 1 && boostCount <= 100);
    if (strict && !boostReady) throw new Error("BOOST needs 1-43200 minutes and 1-100 buys.");
    const valid =
      feeReady &&
      boostReady &&
      Number.isFinite(scheduledAt) &&
      amount !== null &&
      (userFunded() || shares.reduce((a, b) => a + b, 0) === 10_000) &&
      walletReady;
    if (strict && !valid)
      throw new Error(
        "Choose a launch time, available protection and wallet shares adding to 100%.",
      );
    if (
      strict &&
      (scheduledAt < Date.now() + 120_000 ||
        scheduledAt > Date.now() + 7 * 86_400_000)
    )
      throw new Error(
        "Choose a launch time between 2 minutes and 7 days from now.",
      );
    if (strict) { if(batches)allocateUserBatches(batches,scheduledAt);else allocatedBudget(BigInt(amount!), shares); }
    if (profitMode.value === "cashback")
      throw new Error("Cashback rules are not finalized.");
    return parseLaunchSettings({
      firstStrategyLockMs: rules.firstStrategyLockMs,
      minimumActiveMs: rules.minimumActiveMs,
      sniperSeconds: null,
      liquidity: null,
      publishMint: true,
      publishProject: true,
      userBatches: valid ? batches : null,
      holderRewards: feeMode.value === "holders" || (!strict && !valid),
      feesTo: feeMode.value === "creator" && (strict || valid) ? feesTo.value.trim() : null,
      bundleLamports: amount,
      bundleExitPercent: exitPercent(),
      bundleMaxHoldMs: null,
      scheduledAt: valid ? scheduledAt : null,
      walletSharesBps: valid && !batches ? shares : null,
      boost: userFunded() || profitMode.value === "wallet" || (!strict && !valid) ? null : {
        durationMs: boostDuration,
        steps: boostCount,
      },
      profitPolicy: batches ? {mode:"wallet",wallet:batches.proceedsWallet} :
        profitMode.value === "wallet"
          ? strict || profitWallet.value.trim()
            ? { mode: "wallet", wallet: profitWallet.value.trim() }
            : null
          : profitMode.value === "token" ? { mode: "token" } : { mode: "burn" },
    });
  }

  const fill = (input: HTMLInputElement, lo: number, hi: number) => {
    const slider = input.closest<HTMLElement>(".slider");
    slider?.style.setProperty("--lo", `${lo}%`);
    slider?.style.setProperty("--hi", `${hi}%`);
  };
  /** Slider readouts; the two range handles never cross. */
  function readSliders() {
    const lastBundle = Math.max(1, Number(bundleInput.max));
    const stop = Number(bundleInput.value);
    fill(bundleInput, 0, (stop / lastBundle) * 100);
    const size = `${BUNDLE_STOPS_SOL[stop]} SOL`;
    form.querySelector("[data-bundle-out]")!.textContent = size;
    bundleInput.setAttribute("aria-valuetext", size);
    find<HTMLElement>("bundle-fee").textContent =
      `${(bundleFeeLamports(Math.round(BUNDLE_STOPS_SOL[stop]! * 1e9)) / 1e9).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
    const how = (key: string) =>
      form.querySelector<HTMLElement>(`[data-how-${key}]`)!;
    how("size").textContent = size;
    how("exit").textContent = `${exitPercent()}%`;
    how("back").textContent =
      `${+((BUNDLE_STOPS_SOL[stop]! * exitPercent()) / 100).toFixed(4)} SOL`;
  }

  function showSettingsSummary() {
    const settings = readSettings(false);
    find<HTMLElement>("creator-fees-field").hidden = feeMode.value !== "creator";
    find<HTMLElement>("profit-wallet-field").hidden =
      profitMode.value !== "wallet";
    find<HTMLElement>("boost-controls").hidden = profitMode.value === "wallet";
    const amount = bundleLamports();
    const shares = sharesInputs.map((i) => Math.round(Number(i.value) * 100));
    const total = shares.reduce((a, b) => a + b, 0);
    find<HTMLElement>("allocation-total").textContent =
      `${total / 100}%${total === 10000 ? "" : " - must total 100%"}`;
    let buys: bigint[] = [];
    try {
      if (amount) buys = allocatedBudget(BigInt(amount), shares);
    } catch {}
    sharesInputs.forEach(
      (_, i) =>
        (find<HTMLElement>(`wallet-buy-${i}`).textContent =
          buys[i] !== undefined
            ? `${Number(buys[i]) / 1e9} SOL`
            : "Check allocation"),
    );
    const fee = bundleFeeLamports(amount);
    document
      .querySelectorAll<HTMLElement>("[data-summary-bundle]")
      .forEach((n) => (n.hidden = !amount));
    document
      .querySelectorAll<HTMLElement>("[data-summary-fund]")
      .forEach((n) => (n.hidden = true));
    find<HTMLElement>("summary-bundle-fee").textContent = `${fee / 1e9} SOL`;
    // A user-funded launch pays no protection fee: its extra SOL is the buys
    // themselves plus each wallet's network reserve and the Jito tip.
    const columnRead = userFunded() ? launchColumns.read(scheduledNow()) : null;
    find<HTMLElement>("summary-bundle-label").textContent = columnRead
      ? `Buys + ${columnRead.wallets} wallet reserve${columnRead.wallets === 1 ? "" : "s"}`
      : "Sniper protection (3%)";
    if (columnRead) find<HTMLElement>("summary-bundle-fee").textContent =
      `${(columnRead.totalLamports + columnRead.wallets * 14_000_000 + 100_000) / 1e9} SOL`;
    const rows = [
      [
        "Launch time",
        settings.scheduledAt
          ? new Date(settings.scheduledAt).toLocaleString()
          : "Choose a time",
      ],
      ["Protection", amount ? `${amount / 1e9} SOL` : "Awaiting capacity"],
      ["Wallet allocation", shares.map((n) => `${n / 100}%`).join(" / ")],
      ["Sell target", `+${exitPercent() - 100}% per wallet`],
      ["Trading fees", feeMode.value === "holders" ? "Pump holder rewards" : feesTo.value.trim() || "Enter creator-fee wallet"],
      ...(profitMode.value === "wallet" ? [] : [["BOOST", `${boostMinutes.value || "?"} min / up to ${boostSteps.value || "?"} buys after sale`]]),
      [
        "Profit destination",
        profitMode.value === "burn"
          ? "Buy & burn"
          : profitMode.value === "token" ? "$TOKEN holder; approval required" : profitWallet.value.trim() || "Enter a wallet",
      ],
    ];
    if(userFunded()) {
      rows.splice(1,rows.length-1,["Launch buy",amount?`${amount/1e9} SOL (fully funded)`:"Choose each wallet's buy"],...launchColumns.summary(),
        ["Trading fees", feeMode.value === "holders" ? "Pump holder rewards" : feesTo.value.trim() || "Enter creator-fee wallet"],
        ["Proceeds", find<HTMLInputElement>("f-proceeds-wallet").value.trim() || "Enter a wallet"]);
    }
    // Links go into the coin's metadata: worth a last look before paying.
    const xUrl = xLink(normalizeX(x.value));
    rows.push(
      ["Website", websiteOwn.checked && website.value.trim() ? website.value.trim() : "This coin's LaunchSeeds page"],
      ["X", x.value.trim() ? xUrl || "Invalid X link" : "None"],
      ...(telegram.value.trim() ? [["Telegram", telegramLink(telegram.value) || "Invalid Telegram link"]] : []),
    );
    render(
      <>
        {rows.map(([term, value]) => (
          <>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </>
        ))}
      </>,
      find<HTMLElement>("summary-rules"),
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
    const view = launchAvailability(config, extraSol(), {
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
    updateAvailability();
    try {
      readSliders();
      showSettingsSummary();
    } catch {
      /* Invalid setting is reported on submit. */
    }
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
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Image generation failed.",
        );
      }
      const blob = await response.blob();
      const file = new File([blob], `${ticker.value.trim() || "token"}.png`, {
        type: "image/png",
      });
      // Same path as a picked file: validation, preview and upload at submit.
      const transfer = new DataTransfer();
      transfer.items.add(file);
      image.files = transfer.files;
      image.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Image generation failed.",
      );
    } finally {
      generateButton.disabled = false;
      generateButton.classList.remove("is-busy");
      generateButton.textContent = "Generate";
      imageUpload.classList.remove("is-generating");
    }
  });

  /** Clone: fill the form from an existing coin (name, ticker, links, image). */
  cloneButton.addEventListener("click", async () => {
    const mint = cloneInput.value.trim();
    if (!mint) {
      cloneInput.focus();
      return;
    }
    cloneButton.disabled = true;
    cloneStatus.hidden = false;
    cloneStatus.textContent = "Reading the coin…";
    try {
      const coin = await getJson<{
        name: string;
        symbol: string;
        website: string;
        x: string;
        telegram: string;
        image: string | null;
      }>(`/api/clone?mint=${encodeURIComponent(mint)}`);
      name.value = coin.name;
      ticker.value = coin.symbol;
      // A clone never takes the original's website: it gets its own page.
      setOverride(websiteOwn, false);
      x.value = coin.x;
      telegram.value = coin.telegram;
      if (coin.image) {
        const blob = await (await fetch(coin.image)).blob();
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [blob],
            `${coin.symbol || "token"}.${blob.type.split("/")[1] || "png"}`,
            { type: blob.type },
          ),
        );
        image.files = transfer.files;
        image.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const links = [coin.x && "X", coin.telegram && "Telegram"].filter(
        Boolean,
      );
      cloneResult.hidden = false;
      cloneResult.textContent = `Cloned ${coin.name} ($${coin.symbol})${coin.image ? " with its image" : " (no image found)"}${links.length ? `; copied its ${links.join(", ")} link${links.length > 1 ? "s" : ""}. Check them before launching.` : "."} It launches as a new coin.`;
      cloneStatus.hidden = true;
      cloneDialog.close();
      sync();
    } catch (error) {
      cloneStatus.textContent =
        error instanceof Error ? error.message : "That coin could not be read.";
    } finally {
      cloneButton.disabled = false;
    }
  });

  openClone.addEventListener("click", () => {
    cloneStatus.hidden = true;
    cloneDialog.showModal();
    cloneInput.focus();
  });
  cloneInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      cloneButton.click();
    }
  });

  const onDetailChanged = (event: Event) => {
    if (!(event.target as HTMLElement).closest("#first-strategy-root")) sync();
  };
  form.addEventListener("input", onDetailChanged);
  form.addEventListener("change", onDetailChanged);
  /** "Write my own" / "My own": unlocks the field; unticked, it reverts to its default. */
  function setOverride(box: HTMLInputElement, on: boolean) {
    box.checked = on;
    const field = find<HTMLInputElement | HTMLTextAreaElement>(box.dataset.override!);
    field.readOnly = !on;
    field.setAttribute("aria-readonly", String(!on));
    field.closest(".input-locked")?.classList.toggle("is-open", on);
    if (!on) field.value = field.dataset.default ?? "";
    else if (field === website && !field.value) field.value = "https://";
  }
  for (const box of [descriptionOwn, websiteOwn]) {
    box.addEventListener("change", () => {
      setOverride(box, box.checked);
      if (box.checked) find<HTMLInputElement>(box.dataset.override!).focus();
    });
  }
  /** Chip groups: one pressed at a time. */
  for (const attribute of ["data-exit"]) {
    const chips = form.querySelectorAll<HTMLButtonElement>(`[${attribute}]`);
    chips.forEach((chip) =>
      chip.addEventListener("click", () => {
        chips.forEach((other) => {
          other.setAttribute("aria-pressed", String(other === chip));
          if (other.getAttribute("role") === "radio")
            other.setAttribute("aria-checked", String(other === chip));
        });
        sync();
      }),
    );
  }
  // On/off panels.
  form.querySelectorAll<HTMLElement>("[data-toggle-panel]").forEach((panel) => {
    const toggle = panel.querySelector<HTMLButtonElement>("[data-switch]")!;
    const apply = () =>
      panel.classList.toggle(
        "is-off",
        toggle.getAttribute("aria-checked") !== "true",
      );
    toggle.addEventListener("click", () => {
      toggle.setAttribute(
        "aria-checked",
        String(toggle.getAttribute("aria-checked") !== "true"),
      );
      apply();
      sync();
    });
    apply();
  });

  editDetails.addEventListener("click", () => {
    if (
      !prepared ||
      prepared.receivedLamports > 0 ||
      prepared.status !== "funding"
    )
      return;
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
        {
          headers: { authorization: `Bearer ${capability}` },
          timeoutMs: 20_000,
        },
      );
      await sendWalletTransaction(built.transaction);
      feedback.textContent =
        "Payment sent. Waiting for the network to confirm it.";
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
      if (!freeRunning)
        freeButton.hidden = !eligible || !loaded?.freeLaunch?.available;
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
  let puzzle: {
    challenge: string;
    bits: number;
    expiresAt: number;
    poolLamports: number | null;
  } | null = null;
  const freeAuth = () => ({
    headers: { authorization: `Bearer ${capability}` },
    timeoutMs: 20_000,
  });
  const clock = (sec: number) => {
    sec = Math.max(0, Math.round(sec));
    return sec < 60
      ? `${sec}s`
      : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const big = (n: number) =>
    n >= 1e9
      ? `${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `${Math.round(n / 1e3)}K`
          : String(n);
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
      puzzle = await postJson(
        "/api/free-launch",
        { action: "challenge", handle: launchHandle },
        freeAuth(),
      );
    } catch (error) {
      freeRunning = false;
      freeStatus.hidden = false;
      freeStatus.classList.add("is-error");
      freeStatus.textContent =
        error instanceof Error
          ? error.message
          : "Free launch is not available. You can still pay.";
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
    find<HTMLElement>("mine-target").textContent =
      "0".repeat(zeros) + "f".repeat(64 - zeros);
    find<HTMLElement>("mine-pool").textContent =
      puzzle!.poolLamports == null
        ? "—"
        : `${(puzzle!.poolLamports / 1e9).toFixed(2)} SOL`;
    mine.start.focus();
  });

  mine.start.addEventListener("click", () => {
    if (!puzzle) return;
    if (puzzle.expiresAt <= Date.now()) {
      resetMine();
      freeButton.hidden = false;
      freeStatus.hidden = false;
      freeStatus.textContent =
        "The puzzle expired. Press Mine Free Launch to get a new one.";
      return;
    }
    miner ??= createMiner(
      { seed: puzzle.challenge, bits: puzzle.bits },
      { onProgress: progress, onFound: found },
    );
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
    find<HTMLElement>("mine-speed").textContent = !p.speed
      ? "…"
      : p.speed >= 1e6
        ? `${(p.speed / 1e6).toFixed(2)} MH/s`
        : `${Math.round(p.speed / 1e3)} kH/s`;
    find<HTMLElement>("mine-hashes").textContent = big(p.hashes);
    find<HTMLElement>("mine-time").textContent = clock(p.seconds);
    find<HTMLElement>("mine-expected").textContent = p.speed
      ? `~${clock(expected / p.speed)}`
      : "…";
    if (p.bestHex) mine.best.textContent = p.bestHex;
    if (p.now) find<HTMLElement>("mine-now").textContent = p.now;
    mine.work.style.width = `${pct.toFixed(1)}%`;
    mine.work.parentElement!.setAttribute(
      "aria-valuenow",
      String(Math.round(pct)),
    );
    find<HTMLElement>("mine-work-text").textContent =
      `${Math.round((p.hashes / expected) * 100)}% of expected work`;
  }

  async function found(f: MineFound) {
    mineFound = true;
    mine.stop.hidden = true;
    mine.start.hidden = true;
    mine.best.textContent = f.hash;
    mine.best.classList.add("is-ok");
    mine.work.style.width = "100%";
    mine.work.parentElement!.classList.add("is-ok");
    find<HTMLElement>("mine-work-text").textContent =
      `Found after ${big(f.hashes)} hashes in ${clock(f.seconds)}`;
    mineText("Found it. Checking…", "Sending your answer to be verified.");
    try {
      await postJson<{ signature: string }>(
        "/api/free-launch",
        {
          action: "claim",
          handle: launchHandle,
          challenge: puzzle!.challenge,
          nonce: String(f.nonce),
        },
        freeAuth(),
      );
      mineText(
        "Found it. Your launch is free.",
        "The launch fee was sent from the free launch pool. Launching once the network confirms it.",
        "ok",
      );
      payButton.hidden = true;
      void requestStatus().catch(() => {});
    } catch (error) {
      mineText(
        "That answer was not accepted",
        error instanceof Error ? error.message : "Try again, or pay in wallet.",
        "error",
      );
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
    // Saved links reopen as entered, so the summary shows what goes on chain.
    if (status.website !== undefined) {
      const own = !!status.website && !status.website.includes("/coin/");
      setOverride(websiteOwn, own);
      if (own) website.value = status.website;
    }
    if (status.x !== undefined) x.value = status.x;
    if (status.telegram !== undefined) telegram.value = status.telegram;
    // A saved custom description reopens unlocked; the default stays locked.
    if (status.description !== undefined) {
      const own = status.description.trim() !== "" && status.description !== descriptionInput.dataset.default;
      setOverride(descriptionOwn, own);
      if (own) descriptionInput.value = status.description;
    }
    if (destroyed) return;
    prepared = status;
    const reserved = find<HTMLElement>("reserved-ca-preview");
    reserved.hidden = !status.mint;
    find<HTMLElement>("reserved-ca-value").textContent = status.mint;
    find<HTMLElement>("reserved-ca-copy").dataset.copy = status.mint;
    if (status.settings) {
      if (status.settings.scheduledAt) {
        const date = new Date(status.settings.scheduledAt);
        scheduledAtInput.value = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0,16);
        timeMode.value = "date"; timeModeChanged();
      }
      if(status.settings.userBatches && status.settings.scheduledAt) launchColumns.restore(status.settings.userBatches, status.settings.scheduledAt);
      feeMode.value = status.settings.feesTo ? "creator" : "holders";
      feesTo.value = status.settings.feesTo ?? "";
      find<HTMLElement>("creator-fees-field").hidden = feeMode.value !== "creator";
    }
    launchHandle = status.handle;
    // Public launch status also supplies the token identity on a direct
    // /launch?launch=… visit. Never leave the designer's sample $SLAB label.
    const symbol = status.symbol.replace(/^\$/, "").toUpperCase();
    find<HTMLElement>("summary-ticker").textContent = `$${symbol}`;
    find<HTMLElement>("summary-name").textContent = status.name;
    statusPanel
      .querySelectorAll<HTMLElement>("[data-bind-ticker]")
      .forEach((label) => {
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
    find<HTMLElement>("step-token").textContent = live
      ? "Token created"
      : status.launchSignature
        ? "Confirming token"
        : "Creating token";
    visible.forEach((step, index) => {
      step.classList.toggle("is-done", index < completed);
      step.classList.toggle(
        "is-current",
        index === completed && view.phase !== "failed",
      );
    });
    find<HTMLElement>("step-payment").firstChild!.textContent =
      view.phase === "funding" &&
      status.receivedLamports < status.requiredLamports
        ? "Waiting for payment"
        : "Payment received";
    find<HTMLElement>("reward-fund-amount").textContent =
      `${fundAmount.toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;
    if (live && fundAmount > 0 && !status.rewardFundVerified)
      fundStep.title =
        "Awaiting a confirmed treasury token-balance observation";

    statusPanel.hidden = false;
    form.hidden = true;
    find<HTMLElement>("submit-wrap").hidden = true;
    find<HTMLElement>("step-details").className = "is-done";
    find<HTMLElement>("step-deposit").className = live
      ? "is-done"
      : "is-current";
    find<HTMLElement>("step-live").className = live ? "is-done" : "";
    for (const [id, done, number] of [
      ["step-details", true, "1"],
      ["step-deposit", live, "2"],
      ["step-live", live, "3"],
    ] as const) {
      const marker = find<HTMLElement>(id).querySelector("span");
      if (marker) marker.textContent = done ? "✓" : number;
    }
    editingPrepared = false;
    editDetails.hidden =
      view.phase !== "funding" || status.receivedLamports > 0 || !capability;
    payButton.hidden = !view.canFund || !capability;
    paintFreeLaunch(status);
    find<HTMLElement>("step-treasury").textContent = status.settings
      ?.scheduledAt
      ? "Protection wallets prepared"
      : "Treasury created";
    find<HTMLElement>("step-strategy").textContent = status.settings
      ?.scheduledAt
      ? "Published plan recorded"
      : "Strategy and rules set";
    const delayed = status.plan?.status === "delayed";
    const scheduled =
      !!status.settings?.scheduledAt &&
      status.status === "funding" &&
      status.receivedLamports >= status.requiredLamports;
    find<HTMLElement>("pay-title").textContent = live
      ? "Launched"
      : scheduled
        ? delayed
          ? "Launch delayed"
          : "Launch scheduled"
        : view.canFund
          ? status.settings?.scheduledAt
            ? "Fund your schedule"
            : "Pay to launch"
          : "Launching";
    const planRoot = find<HTMLElement>("funded-plan-preview");
    planRoot.hidden = !status.plan;
    if (status.plan)
      // The summary above already lists the plan; the coin page has it in full.
      render(
        <a className="btn" href={`/coin/${status.plan.mint ?? status.plan.planHash}`}>
          View coin page
        </a>,
        planRoot,
      );
    // Moving bar and spinner while preparing, waiting for payment or deploying.
    find<HTMLElement>("launch-busy").hidden = !view.waiting;
    find<HTMLElement>("launch-scan").hidden = !view.waiting;
    find<HTMLElement>("launch-busy-text").textContent = view.canFund
      ? "Waiting for payment"
      : scheduled
        ? delayed
          ? "Awaiting execution"
          : "Scheduled"
        : view.phase === "preparing"
          ? "Preparing"
          : status.launchSignature
            ? "Confirming transaction"
            : "Launching";
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
      feedback.textContent = ok
        ? "Exact SOL amount copied."
        : "Select the amount to copy.";
    };
    const qr = find<HTMLImageElement>("payment-qr");
    if (view.showAddress) {
      address.textContent = status.fundingWallet;
      copy.onclick = async () => {
        const ok = await copyText(status.fundingWallet);
        feedback.textContent = ok
          ? "Address copied."
          : "Select the address to copy.";
      };
      const uri = solanaPayUri(status.fundingWallet, view.requiredSol, symbol);
      if (qr.dataset.uri !== uri) {
        qr.dataset.uri = uri;
        qr.hidden = true;
        void import("qrcode")
          .then(({ default: QRCode }) =>
            QRCode.toDataURL(uri, {
              width: 200,
              margin: 1,
              errorCorrectionLevel: "M",
            }),
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
      find<HTMLElement>("payment-expires").hidden = true;
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
      const text = `$${symbol} is live on ${document.querySelector("[data-brand]")?.getAttribute("data-brand") === "launchseeds" ? "LaunchSeeds" : "LaunchSeeds"}. Public launch plan and protection-wallet rules.`;
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

    const file = image.files?.[0] || null;
    const imageProblem = validateImage(file);
    if (imageProblem) {
      showError(imageProblem);
      return;
    }
    let settings: LaunchSettings;
    try {
      settings = readSettings();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Enter valid launch settings.",
      );
      return;
    }
    const formFields = {
      name: name.value,
      symbol: ticker.value,
      devBuySol: rewardFund(),
      description: descriptionOwn.checked ? descriptionInput.value : "",
      website: websiteOwn.checked ? website.value : "",
      x: x.value,
      telegram: telegram.value,
      image: "",
      firstStrategy: null,
      settings,
    };
    const validation = validateLaunchFields(formFields);
    if (validation) {
      showError(validation);
      return;
    }

    setBusy(true);
    try {
      const selectedProtection = bundleLamports();
      config = await getJson<Config>("/api/launch-config");
      applyProtectionBudget();
      sync();
      if (!config.launchEnabled)
        throw new Error(
          "Launch connection is recovering. Please retry shortly.",
        );
      if (selectedProtection !== bundleLamports())
        throw new Error(
          "Protection availability changed. Review the updated amount, then continue.",
        );
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
        if (
          !validLaunchStatus(amended) ||
          amended.handle !== prepared.handle ||
          amended.fundingWallet !== prepared.fundingWallet
        ) {
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

    try {
      config = await getJson<Config>("/api/launch-config");
    } catch {
      config = null;
    }
    if (destroyed) return;
    generateButton.hidden = !config?.imageGeneration;
    // Availability disables the controls without changing the chosen mode.
    applyProtectionBudget();
    checking = false;
    // The upstream catalogue can be unavailable without disabling burn or
    // wallet strategies. The strategy builder validates each selection.
    sync();
  }

  async function refreshReadiness(quiet = false) {
    if (destroyed || checking || busy || prepared) return;
    checking = true;
    if (!quiet) updateAvailability();
    try {
      const latest = await getJson<Config>("/api/launch-config");
      if (destroyed) return;
      config = latest;
      freeConfig = Promise.resolve(latest);
      if (latest.launchEnabled && !quiet) clearError();
    } catch {
      // A transport failure is unknown, not proof the service is disabled.
      // Keep the last observation; submission always rechecks server readiness.
    } finally {
      if (!destroyed) {
        checking = false;
        applyProtectionBudget();
        sync();
      }
    }
  }
  const onReturn = () => {
    if (!document.hidden) void refreshReadiness();
  };
  const onRecheck = () => {
    void refreshReadiness();
  };
  recheck.addEventListener("click", onRecheck);
  const budgetTimer = setInterval(() => {
    if (!document.hidden && !launchHandle) void refreshReadiness(true);
  }, 10_000);
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  sync();
  void initialise().catch(() => {
    if (destroyed) return;
    checking = false;
    config = null;
    updateAvailability();
  });
  return () => {
    destroyed = true;
    stopLaunchCountdown();
    timeMode.removeEventListener("change",timeModeChanged);
    recheck.removeEventListener("click", onRecheck);
    clearInterval(budgetTimer);
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
    miner?.stop();
    latestRequest++;
    stopTimers();
    if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    render(null, find<HTMLElement>("summary-rules"));
  };
}
