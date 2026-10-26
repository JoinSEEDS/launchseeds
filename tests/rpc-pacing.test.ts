import { expect, test } from "bun:test";
import { createRpcTransport, createRpcConnection, rpcFetch } from "../src/server/rpc-pacing";

test("RPC adapter reuses Solard pools and leaves global fetch unchanged", async () => {
  const original = globalThis.fetch; let pools = 0, sends = 0;
  const transport = createRpcTransport(async () => ({ SolardRpcEndpointPool: class {
    constructor(readonly urls: string[]) { pools++; }
    async fetch() { sends++; return Response.json({ ok: true }); }
  } }));
  await transport("https://rpc.example/"); await transport("https://rpc.example/");
  expect(pools).toBe(1); expect(sends).toBe(2); expect(globalThis.fetch).toBe(original);
  await import("../src/server/rpc-pacing-install");
  expect(globalThis.fetch).toBe(original);
});

test("an aborted request waiting for SDK loading cannot send later", async () => {
  let resolve!: (value: any) => void, sends = 0;
  const transport = createRpcTransport(() => new Promise(r => { resolve = r; }));
  const controller = new AbortController();
  const result = transport("https://rpc.example/", { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toThrow();
  resolve({ SolardRpcEndpointPool: class { async fetch() { sends++; return new Response(); } } });
  await Bun.sleep(0); expect(sends).toBe(0);
});

test("real Solard queue honors an aborted queued read and never broadcasts it later", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    const body = await request.json() as { id: number };
    sends.push(body.id); return Response.json({ jsonrpc: "2.0", id: body.id, result: "ok" });
  } });
  const sends: number[] = [];
  const prior = process.env.SLRD_RPC_PROVIDER_LIMITS;
  process.env.SLRD_RPC_PROVIDER_LIMITS = JSON.stringify({ "127.0.0.1": { group: "test-" + crypto.randomUUID(), rps: 1, concurrency: 1 } });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const request = (id: number, signal?: AbortSignal) => rpcFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "getSlot" }), signal });
    await request(1);
    const controller = new AbortController();
    const start = Date.now(); const pending = request(2, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow(); expect(Date.now() - start).toBeLessThan(500);
    await Bun.sleep(1100); expect(sends).toEqual([1]);
  } finally { if (prior === undefined) delete process.env.SLRD_RPC_PROVIDER_LIMITS; else process.env.SLRD_RPC_PROVIDER_LIMITS = prior; server.stop(true); }
});

test("plain web3 connections use the adapter rather than web3's extra rate-limit retry", () => {
  const connection = createRpcConnection("http://127.0.0.1:1", "finalized");
  expect(connection.commitment).toBe("finalized");
});
