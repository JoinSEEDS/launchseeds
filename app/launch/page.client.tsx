import { render } from "tradjs/client";
import { createStrategyBuilder } from "../components/strategy-builder";
import { strategySummary } from "../../lib/strategy-presenter";
import { launchAvailability } from "../../lib/launch-presentation";
import { walletProvider } from "../../lib/vote-ui";
import {
  publishWallet,
  subscribeWallet,
  trackWalletProvider,
} from "../../lib/wallet-session";
import {
  validateFundingTransaction,
  type UnsignedPayment,
} from "../../lib/funding-transaction";
import type { Catalog } from "../../lib/catalog";
import type { Strategy } from "../../lib/strategy";
import {
  getJson,
  postJson,
  uploadImage,
  copyText,
  SequentialPoller,
} from "../../lib/client-request";
import {
  buildLaunchPayload,
  launchUrl,
  launchView,
  phaseClass,
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
  const errorBox = find<HTMLElement>("launch-error");
  const readiness = find<HTMLElement>("launch-ready-hint");
  const submit = find<HTMLButtonElement>("get-deposit");
  const actionWrap = find<HTMLElement>("submit-wrap");
  const previewRoot = find<HTMLElement>("launch-first-preview");
  const builderRoot = find<HTMLElement>("first-strategy-root");
  const statusPanel = find<HTMLElement>("launch-status-panel");
  const statusText = find<HTMLElement>("payment-status");
  const retryButton = find<HTMLButtonElement>("retry-launch-status");
  const payButton = find<HTMLButtonElement>("pay-with-wallet");
  const avatar = find<HTMLElement>("launch-avatar");
  const imageUpload = find<HTMLElement>("image-upload");

  let catalog: Catalog | null = null;
  let current: Strategy | null = null;
  let builder: ReturnType<typeof createStrategyBuilder> | null = null;
  let config: Config | null = null;
  let checking = true;
  let walletAddress = "";
  let sendingPayment = false;
  let paymentSubmitted = false;
  let prepared: PublicLaunchStatus | null = null;
  let launchUid = "";
  let pendingPayload = "";
  let capability = "";
  let busy = false;
  let destroyed = false;
  let pictureUrl: string | null = null;
  let poller: SequentialPoller | null = null;
  let latestRequest = 0;

  const showError = (message: string) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };
  const clearError = () => {
    errorBox.textContent = "";
    errorBox.hidden = true;
  };
  const stopPolling = () => {
    poller?.stop();
    poller = null;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    updateAvailability();
    submit.setAttribute("aria-busy", String(value));
  };

  function updateAvailability() {
    const view = launchAvailability(config, dev.value, {
      checking,
      busy,
      connected: Boolean(walletAddress),
    });
    submit.disabled = view.disabled;
    submit.textContent = view.buttonLabel;
    actionWrap.hidden = !view.showAction;
    readiness.hidden = !view.showUnavailable;
    readiness.textContent = view.message;
    find<HTMLElement>("summary-fee").textContent = view.fee;
    find<HTMLElement>("summary-total").textContent = view.total;
  }

  // Provider account changes and external disconnects also update the
  // launch CTA; it should never show Launch for a disconnected wallet.
  const stopWalletEvents = subscribeWallet((next) => {
    walletAddress = next;
    if (!destroyed) updateAvailability();
  });

  /** Keep the same direct render pattern; only the summary is client-owned. */
  const sync = () => {
    find<HTMLElement>("summary-name").textContent =
      name.value.trim() || "Untitled";
    find<HTMLElement>("summary-ticker").textContent =
      "$" + (ticker.value.trim() || "TOKEN").replace(/^\$/, "").toUpperCase();
    if (!avatar.querySelector("img")) {
      avatar.textContent = (name.value.trim() || "T")
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || "")
        .join("")
        .toUpperCase();
    }
    find<HTMLElement>("summary-dev").textContent = dev.value || "0";
    updateAvailability();
    form.querySelectorAll<HTMLButtonElement>("[data-dev]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.dev === dev.value),
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
  form.addEventListener("input", (event) => {
    if (!(event.target as HTMLElement).closest("#first-strategy-root")) sync();
  });
  form.querySelectorAll<HTMLButtonElement>("[data-dev]").forEach((button) => {
    button.addEventListener("click", () => {
      dev.value = button.dataset.dev || "0";
      sync();
    });
  });

  function showStatus(status: PublicLaunchStatus) {
    if (destroyed) return;
    prepared = status;
    launchUid = status.uid;
    // Public launch status also supplies the token identity on a direct
    // /launch?uid=… visit. Never leave the designer's sample $SLAB label.
    const symbol = status.symbol.replace(/^\$/, "").toUpperCase();
    find<HTMLElement>("summary-ticker").textContent = `$${symbol}`;
    find<HTMLElement>("summary-name").textContent = status.name;
    const launchLabel = document.querySelector<HTMLElement>(
      "#launched-token-link [data-bind-ticker]",
    );
    if (launchLabel) launchLabel.textContent = `$${symbol}`;
    const link = launchUrl(status.uid);
    if (link && location.pathname + location.search !== link) {
      history.replaceState(null, "", link);
    }
    const view = launchView(status);
    const steps = Array.from(
      document.querySelectorAll<HTMLElement>("#launch-checklist li"),
    );
    const completed =
      view.phase === "live"
        ? steps.length
        : view.phase === "deploying"
          ? 2
          : view.phase === "funding"
            ? 1
            : 0;
    steps.forEach((step, index) => {
      step.classList.toggle("is-done", index < completed);
      step.classList.toggle(
        "is-current",
        index === completed && !view.isComplete,
      );
      const detail = step.querySelector<HTMLElement>("span");
      if (detail)
        detail.textContent =
          index === 0 && index < completed
            ? "Ready"
            : index === 1 && index < completed
              ? "Confirmed"
              : index === 2 && view.phase === "live"
                ? "Live"
                : "";
    });
    statusPanel.hidden = false;
    form.hidden = true;
    find<HTMLElement>("submit-wrap").hidden = true;
    find<HTMLElement>("step-details").className = "is-done";
    find<HTMLElement>("step-deposit").className =
      view.phase === "live" ? "is-done" : "is-current";
    find<HTMLElement>("step-live").className =
      view.phase === "live" ? "is-current" : "";
    const pill = find<HTMLElement>("launch-status-pill");
    pill.textContent = view.title;
    pill.className = phaseClass(view.phase);
    statusText.textContent = view.message;
    find<HTMLElement>("payment-amount").textContent = view.canFund
      ? `${view.requiredSol} SOL`
      : "—";
    find<HTMLElement>("funding-details").hidden = !view.showAddress;
    payButton.hidden = !view.canFund || !capability || paymentSubmitted;
    payButton.disabled = sendingPayment;

    const address = find<HTMLElement>("payment-address");
    const copy = find<HTMLButtonElement>("copy-address");
    const qr = find<HTMLImageElement>("payment-qr");
    address.hidden = !view.showAddress;
    copy.hidden = !view.showAddress;
    qr.hidden = !view.showAddress || !qr.src;
    if (view.showAddress) {
      address.textContent = status.fundingWallet;
      copy.onclick = async () => {
        const ok = await copyText(status.fundingWallet);
        copy.textContent = ok ? "Copied" : "Select the address to copy";
      };
      if (qr.dataset.address !== status.fundingWallet) {
        qr.dataset.address = status.fundingWallet;
        qr.src = "";
        void import("qrcode")
          .then(({ default: QRCode }) =>
            QRCode.toDataURL(status.fundingWallet, {
              width: 180,
              margin: 1,
              errorCorrectionLevel: "M",
            }),
          )
          .then((source) => {
            if (
              prepared?.fundingWallet === status.fundingWallet &&
              !destroyed
            ) {
              qr.src = source;
              qr.hidden = false;
            }
          })
          .catch(() => {
            qr.hidden = true;
          });
      }
    } else {
      address.textContent = "";
      qr.removeAttribute("src");
      qr.dataset.address = "";
    }

    const progress = find<HTMLElement>("deposit-progress");
    progress.setAttribute("aria-valuenow", String(Math.floor(view.progress)));
    const bar = progress.querySelector<HTMLElement>("i");
    if (bar) bar.style.width = `${view.progress}%`;
    progress.hidden = !view.canFund;

    const tokenLink = find<HTMLAnchorElement>("launched-token-link");
    const url = publicTokenUrl(status.uid);
    tokenLink.hidden = !view.showTokenLink || !url;
    if (url) tokenLink.href = url;
    retryButton.hidden = view.isComplete;
    if (view.isComplete) stopPolling();
  }

  async function requestStatus(signal?: AbortSignal) {
    if (!launchUid) return;
    const sequence = ++latestRequest;
    const status = await getJson<PublicLaunchStatus>(
      `/api/launches/${encodeURIComponent(launchUid)}`,
      { signal, timeoutMs: 12_000 },
    );
    if (!validLaunchStatus(status))
      throw new Error("Launch status response was incomplete.");
    if (destroyed || sequence !== latestRequest) return;
    showStatus(status);
  }

  /** Send only an operator-verified unsigned transaction, after wallet approval. */
  async function sendPayment() {
    if (sendingPayment || paymentSubmitted || !prepared || !capability) return;
    if (!launchView(prepared).canFund) return;
    const provider = walletProvider(window);
    if (!provider || typeof provider.signAndSendTransaction !== "function") {
      statusText.textContent =
        "Your wallet does not support in-app payments. Send SOL to the funding address shown above instead.";
      return;
    }
    sendingPayment = true;
    payButton.disabled = true;
    payButton.textContent = "Confirm in wallet…";
    try {
      const connected = await provider.connect();
      const wallet = connected.publicKey?.toString() || "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet))
        throw new Error("Connect a Solana wallet to pay.");
      walletAddress = wallet;
      trackWalletProvider(provider);
      publishWallet(wallet);
      const preparedPayment = await postJson<UnsignedPayment>(
        "/api/launch-payment",
        { uid: prepared.uid, wallet },
        {
          headers: { authorization: `Bearer ${capability}` },
          timeoutMs: 20_000,
        },
      );
      // Independently validate the exact SOL transfer and reject any extra
      // instructions before asking the wallet to authorize payment.
      const transaction = validateFundingTransaction({
        payment: preparedPayment,
        launch: prepared,
        payer: wallet,
      });
      // Exactly one user-authorized SOL transfer funds the launch. The worker
      // handles deployment separately after verifying the transfer on chain.
      await provider.signAndSendTransaction(transaction);
      paymentSubmitted = true;
      payButton.hidden = true;
      statusText.textContent =
        "Payment submitted. Waiting for network confirmation.";
      startPolling();
    } catch (error) {
      statusText.textContent =
        error instanceof Error ? error.message : "Payment was not sent.";
    } finally {
      sendingPayment = false;
      payButton.disabled = false;
      payButton.textContent = "Pay in Wallet";
    }
  }
  payButton.addEventListener("click", () => {
    void sendPayment();
  });

  function startPolling() {
    stopPolling();
    poller = new SequentialPoller(requestStatus, 10_000, (error) => {
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
    if (busy || prepared) return;
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
    const formFields = {
      name: name.value,
      symbol: ticker.value,
      devBuySol: dev.value,
      website: website.value,
      x: x.value,
      telegram: telegram.value,
      image: "",
      firstStrategy: result.config,
    };
    const validation = validateLaunchFields(formFields);
    if (validation) {
      showError(validation);
      return;
    }

    setBusy(true);
    try {
      const provider = walletProvider(window);
      if (!provider)
        throw new Error("Install a Solana wallet to launch your token.");
      const connected = await provider.connect();
      const address = connected.publicKey?.toString() || "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
        throw new Error("Wallet connection failed.");
      walletAddress = address;
      trackWalletProvider(provider);
      publishWallet(address);
      updateAvailability();
      // The launch service prepares a unique deposit; the status page shows
      // the payment amount and address for wallet confirmation. Never imply
      // that connecting a wallet alone transferred SOL or deployed the mint.
      // The artwork is uploaded only after local validation succeeds. The
      // canonical launch endpoint independently validates the resulting URL.
      const uploaded = await uploadImage<UploadResult>("/api/media", file!);
      if (!uploaded.image)
        throw new Error("Image hosting did not return a URL.");
      const payload = JSON.stringify(
        buildLaunchPayload({ ...formFields, image: uploaded.image }),
      );
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
      if (!launchView(response).isComplete) startPolling();
      // A prepared address may be ready immediately. The wallet still presents
      // and requires explicit confirmation of its SOL transfer.
      if (launchView(response).canFund) await sendPayment();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to prepare launch.",
      );
    } finally {
      setBusy(false);
    }
  });

  // A prepared launch cannot be edited in place. This intentionally does not
  // restore form inputs or create a second funding address.
  find<HTMLButtonElement>("back-to-form").hidden = true;

  async function initialise() {
    const existing = new URLSearchParams(location.search).get("uid");
    if (existing) {
      checking = false;
      readiness.hidden = true;
      actionWrap.hidden = true;
      const link = launchUrl(existing);
      if (!link) {
        showError("Invalid launch URL.");
        return;
      }
      launchUid = existing;
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
    builder = createStrategyBuilder(builderRoot, {
      catalog,
      onChange: (next) => {
        current = next;
        sync();
      },
    });
    checking = false;
    // The upstream catalogue can be unavailable without disabling burn or
    // wallet strategies. The strategy builder validates each selection.
    sync();
  }

  sync();
  void initialise().catch(() => {
    if (destroyed) return;
    checking = false;
    config = { launchEnabled: false, baseFeeLamports: null, message: "" };
    updateAvailability();
  });
  return () => {
    destroyed = true;
    latestRequest++;
    stopPolling();
    stopWalletEvents();
    if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    render(null, previewRoot);
    render(null, builderRoot);
  };
}
