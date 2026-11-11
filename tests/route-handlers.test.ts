import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { insertToken } from "./fixtures";
import { getStore } from "../src/server/runtime";
import { GET as health } from "../app/api/health/route";
import { GET as tokens } from "../app/api/tokens/route";
import { GET as tokenDetails } from "../app/api/tokens/[uid]/route";
import { GET as tokenMetadata } from "../app/api/metadata/[uid]/route";
import { POST as seedLaunch } from "../app/api/seeds/route";

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
    const request = new Request(`${origin}/api/seeds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X", symbol: "X" }),
    });
    const response = await seedLaunch(request);
    expect(response.status).toBe(403);
  });

  test("launch mutation does not prepare wallets in disabled mode", async () => {
    const request = new Request(`${origin}/api/seeds`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    const response = await seedLaunch(request);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await body(response))).toContain(
      "temporarily unavailable",
    );
  });

  test("unknown IDs and malformed nested routes return 404", async () => {
    const routes = [
      tokenDetails(url("/api/tokens/not-a-uuid")),
      tokenMetadata(url("/api/metadata/not-a-uuid")),
    ];
    for (const response of routes) expect(response.status).toBe(404);
  });


});

test("routes are independently implemented rather than method/path dispatched", () => {
  for (const file of [
    "app/api/health/route.ts",
    "app/api/tokens/route.ts",
    "app/api/tokens/[uid]/route.ts",
    "app/api/metadata/[uid]/route.ts",
    "app/api/seeds/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("handleApi");
    expect(source).toMatch(/export (async )?function (GET|POST)/);
  }
});
