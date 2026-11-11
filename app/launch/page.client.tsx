import bs58 from "bs58";
import { connectWallet } from "../../lib/wallet-session";
import { walletProvider } from "../../lib/wallet-provider";
import { getJson, postJson, uploadImage } from "../../lib/client-request";
import { seedMessage, type SeedRequest } from "../../lib/seed-message";
import { TICKER_PATTERN, normalizeTicker } from "../../lib/ticker";
import { validateImage } from "../../lib/launch-ui";

type QueueState =
  | { key: string; status: "started"; coinUrl: string | null }
  | { key: string; status: "failed"; error: string }
  | { key: string; status: "waiting"; position: number; ahead: number; etaSeconds: number; note?: string | null };
const wait = (seconds: number) => (seconds < 60 ? "less than a minute" : `about ${Math.round(seconds / 60)} min`);

type Config = { launchEnabled: boolean; imageGeneration?: boolean; seedBundleLamports?: number | null };

export default function mount() {
  const form = document.getElementById("seed-form") as HTMLFormElement | null;
  if (!form) return;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const image = get<HTMLInputElement>("f-image"), name = get<HTMLInputElement>("f-name"), ticker = get<HTMLInputElement>("f-ticker");
  const description = get<HTMLTextAreaElement>("f-desc"), x = get<HTMLInputElement>("f-x"), telegram = get<HTMLInputElement>("f-tg");
  const submit = get<HTMLButtonElement>("seed-submit"), errorBox = get<HTMLElement>("seed-error"), bundle = get<HTMLElement>("seed-bundle");
  const upload = get<HTMLElement>("image-upload"), generate = get<HTMLButtonElement>("generate-image");
  let file: File | null = null, preview: string | null = null;
  const fail = (message: string) => { errorBox.textContent = message; errorBox.hidden = false; };
  const setFile = (next: File | null) => {
    file = next;
    if (preview) URL.revokeObjectURL(preview);
    preview = file ? URL.createObjectURL(file) : null;
    if (preview) showImage(preview);
  };
  const showImage = (src: string) => {
    let img = upload.querySelector("img");
    if (!img) { img = document.createElement("img"); upload.prepend(img); }
    img.src = src;
    img.alt = "";
  };
  image.addEventListener("change", () => {
    setFile(image.files?.[0] ?? null);
  });
  void getJson<Config>("/api/launch-config").then((config) => {
    generate.hidden = !config.imageGeneration;
    bundle.textContent = config.seedBundleLamports
      ? `Launch buy: ${(config.seedBundleLamports / 1e9).toFixed(2)} SOL from the treasury, sold right after launch.`
      : config.launchEnabled ? "" : "Launches are temporarily unavailable.";
  }).catch(() => {});
  generate.addEventListener("click", async () => {
    if (!name.value.trim()) return fail("Enter a name first.");
    generate.disabled = true;
    try {
      const response = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.value.trim(), symbol: ticker.value.trim() }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "Image generation failed.");
      setFile(new File([await response.blob()], "image.png", { type: response.headers.get("content-type") || "image/png" }));
    } catch (error) {
      fail(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      generate.disabled = false;
    }
  });
  /** Shows the place in line until the launch starts, then opens its coin page. */
  async function follow(state: QueueState): Promise<void> {
    for (;;) {
      if (state.status === "started") { if (state.coinUrl) location.assign(state.coinUrl); return; }
      if (state.status === "failed") throw new Error(state.error);
      bundle.textContent = state.ahead
        ? `You're #${state.position} in line: ${state.ahead} ${state.ahead === 1 ? "launch" : "launches"} ahead of you, ${wait(state.etaSeconds)}. It starts by itself, even if you close this page.`
        : `You're next: ${wait(state.etaSeconds)}. ${state.note ?? "It starts by itself, even if you close this page."}`;
      submit.textContent = "Waiting for your turn…";
      await new Promise((r) => setTimeout(r, 5_000));
      state = await getJson<QueueState>(`/api/seeds?key=${state.key}`);
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const symbol = ticker.value.trim().replace(/^\$/, "");
    if (!name.value.trim() || name.value.trim().length > 32) return fail("Enter a name up to 32 characters.");
    if (!TICKER_PATTERN.test(symbol)) return fail("Use up to 13 letters or digits for the ticker.");
    const problem = validateImage(file);
    if (problem) return fail(problem);
    submit.disabled = true;
    try {
      submit.textContent = "Connecting wallet…";
      const wallet = await connectWallet(window);
      const provider = walletProvider(window);
      if (!provider) throw new Error("Connect a supported Solana wallet.");
      submit.textContent = "Uploading image…";
      const picture = (await uploadImage<{ image: string }>("/api/media", file!)).image;
      const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const seed: SeedRequest = {
        wallet,
        name: name.value.trim(),
        symbol: normalizeTicker(symbol),
        description: description.value,
        image: picture,
        website: "",
        x: x.value,
        telegram: telegram.value,
        issuedAt: Date.now(),
        nonce,
      };
      submit.textContent = "Sign in your wallet…";
      const signed = await provider.signMessage(new TextEncoder().encode(seedMessage(seed)), "utf8");
      submit.textContent = "Launching…";
      const result = await postJson<QueueState>("/api/seeds", { ...seed, signature: bs58.encode(signed.signature) }, { timeoutMs: 120_000 });
      await follow(result);
    } catch (error) {
      fail(error instanceof Error ? error.message : "The launch failed.");
    } finally {
      submit.disabled = false;
      submit.textContent = "Connect wallet and launch";
    }
  });
  return () => { if (preview) URL.revokeObjectURL(preview); };
}
