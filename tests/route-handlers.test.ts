import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { insertToken, seedHolder } from "./fixtures";
import { getStore } from "../src/server/runtime";
import { GET as health } from "../app/api/health/route";
import { GET as tokens } from "../app/api/tokens/route";
import { GET as tokenDetails } from "../app/api/tokens/[uid]/route";
import { GET as holderChance } from "../app/api/tokens/[uid]/chance/route";
import { GET as tokenMetadata } from "../app/api/metadata/[uid]/route";
import { GET as launchStatus } from "../app/api/launches/[uid]/route";
import { POST as prepareLaunch } from "../app/api/launches/route";

process.env.LAUNCHSEEDS_DB_PATH = ":memory:";
process.env.LAUNCHSEEDS_LAUNCH_ENABLED = "false";
process.env.LAUNCHSEEDS_LIVE_OPERATIONS = "false";
process.env.LAUNCHSEEDS_WORKER_ENABLED = "false";

const origin = "https://launchseeds.xyz";
const uid = "550e8400-e29b-41d4-a716-446655440000";
const wallet = "11111111111111111111111111111111";
const url = (path: string) => new Request(`${origin}${path}`);

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("method-specific route handlers", () => {
  test("health is a read-only response with no worker started", async () => {
    const response = health();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await body(response)).toMatchObject({
      ok: true,
      launchEnabled: false,
      workersStartedByWeb: false,
    });
  });

  test("launch mutation rejects absent origin before touching funding", async () => {
    const request = new Request(`${origin}/api/launches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstStrategy: { type: "burn", amount: 25 } }),
    });
    const response = await prepareLaunch(request);
    expect(response.status).toBe(403);
  });

  test("launch mutation does not prepare wallets in disabled mode", async () => {
    const request = new Request(`${origin}/api/launches`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    const response = await prepareLaunch(request);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await body(response))).toContain(
      "temporarily unavailable",
    );
  });

  test("unknown IDs and malformed nested routes return 404", async () => {
    const routes = [
      tokenDetails(url("/api/tokens/not-a-uuid")),
      tokenMetadata(url("/api/metadata/not-a-uuid")),
      holderChance(url("/api/tokens/not-a-uuid/chance?wallet=" + wallet)),
    ];
    for (const response of routes) expect(response.status).toBe(404);
    expect((await launchStatus(url("/api/launches/not-a-uuid"))).status).toBe(
      404,
    );
  });

  test("live token data comes from the canonical store and is redacted", async () => {
    const store = getStore();
    const token = insertToken(store, {
      handle: uid.replaceAll("-", ""),
      name: "Example",
      symbol: "EX",
      mint: wallet,
      fundingWallet: wallet,
      rewardWallet: wallet,
      creatorWallet: wallet,
    });
    const holderWallet = Keypair.generate().publicKey.toBase58();
    seedHolder(store, token.id, holderWallet);

    const listing = await body(tokens());
    expect((listing.tokens as { mint: string }[]).map((x) => x.mint)).toContain(
      wallet,
    );
    // Public token APIs are addressed by CA and never return internal ids.
    expect(JSON.stringify(listing)).not.toContain(token.handle);
    expect((listing.tokens as object[])[0]).not.toHaveProperty("id");
    expect((await tokenDetails(url(`/api/tokens/${uid}`))).status).toBe(404);
    const details = await body(tokenDetails(url(`/api/tokens/${wallet}`)));
    expect(details.mint).toBe(wallet);
    expect(JSON.stringify(details)).not.toContain(token.handle);
    expect(details).not.toHaveProperty("id");
    expect(details).not.toHaveProperty("accessHash");
    expect(details).not.toHaveProperty("fundingWallet");
    expect(details).not.toHaveProperty("requestHash");
    const metadata = await body(tokenMetadata(url(`/api/metadata/${wallet}`)));
    expect(metadata.name).toBe("Example");
    expect(metadata.description).toBe("Official description");
    const chance = await body(
      holderChance(url(`/api/tokens/${wallet}/chance?wallet=${holderWallet}`)),
    );
    expect(chance.balance).toBe(25);
    expect(chance.gravity).toBe(100);
    expect(chance.probability).toBe(1);
    store.repo.holders.syncBalance({ tokenId: token.id, wallet: holderWallet, balanceRaw: "0", slot: 2, observedAt: Date.now() + 1 });
    const sold = await body(holderChance(url(`/api/tokens/${wallet}/chance?wallet=${holderWallet}`)));
    expect(sold.balance).toBe(0);
    expect(sold.gravity).toBe(100);
    expect(sold.probability).toBe(1);
    const status = await body(await launchStatus(url(`/api/launches/${token.handle}`)));
    expect(status.handle).toBe(token.handle);
    expect(status).not.toHaveProperty("id");
    expect(status).not.toHaveProperty("accessHash");
  });

  test("unlisted token does not disclose its holder data", async () => {
    const notFound = crypto.randomUUID();
    expect((await tokenDetails(url(`/api/tokens/${notFound}`))).status).toBe(
      404,
    );
  });
});

test("routes are independently implemented rather than method/path dispatched", () => {
  for (const file of [
    "app/api/health/route.ts",
    "app/api/tokens/route.ts",
    "app/api/tokens/[uid]/route.ts",
    "app/api/tokens/[uid]/chance/route.ts",
    "app/api/metadata/[uid]/route.ts",
    "app/api/launches/route.ts",
    "app/api/launches/[uid]/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("handleApi");
    expect(source).toMatch(/export (async )?function (GET|POST)/);
  }
});
