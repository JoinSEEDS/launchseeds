/** An admin launch from the server terminal: it joins the launch queue like any
 * signed request from the site and runs through the same pipeline (treasury
 * bundle, staggered sells, payback). Prints the coin page once it starts.
 *   bgrun inline -- bun run scripts/admin-launch.ts --name "Seeds" --symbol SEEDS \
 *     --image assets/logo.png --description "..." [--website URL] [--x URL] [--telegram URL] [--wallet ADMIN]
 * Without --yes it only prints what it would launch. */
import { createHash, randomBytes } from "node:crypto";
import { getStore } from "../src/server/runtime";
import { adminWallets } from "../src/server/admin-wallets";
import { queueKey, queueState } from "../src/server/launch-queue";
import { isSeedsSymbol, seedsMint } from "../src/domain/seeds-split";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? "" : ""; };
const name = arg("name"), symbol = arg("symbol").replace(/^\$/, ""), description = arg("description"), imagePath = arg("image");
const wallet = arg("wallet") || adminWallets()[0] || "";
if (!name || !symbol || !imagePath) throw new Error("--name, --symbol and --image are required");
if (!adminWallets().includes(wallet)) throw new Error("--wallet must be an admin wallet");
const plan = { name, symbol, description, image: imagePath, website: arg("website"), x: arg("x"), telegram: arg("telegram"), wallet, ...(isSeedsSymbol(symbol) ? { mint: seedsMint() } : {}) };
console.log(JSON.stringify(plan, null, 2));
if (!process.argv.includes("--yes")) { console.log("Dry run. Add --yes to launch."); process.exit(0); }

const base = process.env.PUBLIC_BASE_URL || "https://launchseeds.xyz";
const bytes = await Bun.file(imagePath).arrayBuffer();
const type = imagePath.endsWith(".png") ? "image/png" : imagePath.endsWith(".webp") ? "image/webp" : imagePath.endsWith(".gif") ? "image/gif" : "image/jpeg";
const upload = await fetch(`${base}/api/media`, { method: "POST", headers: { "content-type": type, origin: base }, body: bytes });
if (!upload.ok) throw new Error(`Image upload failed: ${upload.status} ${await upload.text()}`);
const image = ((await upload.json()) as { image: string }).image;

const store = getStore(), capability = createHash("sha256").update(randomBytes(32)).digest("hex"), key = queueKey(capability);
const input = { name, symbol, description, image, website: plan.website, x: plan.x, telegram: plan.telegram, devBuySol: "0" };
const entry = store.repo.launchQueue.add({ key, capability, wallet, inputJson: JSON.stringify(input), now: Date.now(), scheduledFor: Date.now() });
store.repo.launchQueue.approve(entry.id, wallet, Date.now()); // an admin's own launch goes now
console.log(`Queued ${key}; the web server starts it when the treasury is free.`);
for (let i = 0; i < 120; i++) {
  const state = queueState(store, key);
  if (state?.status === "started") { console.log(`Started: ${base}${state.coinUrl}`); process.exit(0); }
  if (state?.status === "failed") throw new Error(state.error);
  if (i % 6 === 0 && state?.status === "waiting") console.log(`Waiting: #${state.position}${state.note ? ` (${state.note})` : ""}`);
  await Bun.sleep(5_000);
}
console.log("Still waiting after 10 minutes; check /api/seeds?key=" + key);
process.exit(0);
