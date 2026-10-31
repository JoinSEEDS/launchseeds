/** Use Solard's scheduler; never wrap global fetch in a second RPC queue. */
import { Connection, type Commitment, type FetchFn } from "@solana/web3.js";
import { rpcUrlList } from "./rpc-urls";
export interface RpcPool {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
async function cancelledWait<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cancel = () =>
      reject(signal.reason ?? new DOMException("RPC cancelled", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}
let modulePromise:
  | Promise<{ SolardRpcEndpointPool: new (urls: string[]) => RpcPool }>
  | undefined;
async function loadRpcPool() {
  const name: string = "@solard/core/chain/connection.ts";
  return (modulePromise ??= import(name).catch((error) => {
    modulePromise = undefined;
    throw error;
  }));
}
/** SDK pools share their provider scheduler with these explicit RPC clients. */
export function createRpcTransport(load = loadRpcPool) {
  const pools = new Map<string, Promise<RpcPool>>();
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    signal?.throwIfAborted();
    let pool = pools.get(url);
    if (!pool) {
      pool = load()
        .then((module) => new module.SolardRpcEndpointPool(rpcUrlList(url)))
        .catch((error) => {
          pools.delete(url);
          throw error;
        });
      pools.set(url, pool);
    }
    const ready = await cancelledWait(pool, signal);
    signal?.throwIfAborted();
    return ready.fetch(input, init);
  };
}
export const rpcFetch = createRpcTransport();
export function createRpcConnection(
  url: string,
  commitment: Commitment = "confirmed",
) {
  return new Connection(url, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: rpcFetch as FetchFn,
  });
}
