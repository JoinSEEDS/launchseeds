import { AsyncLocalStorage } from "node:async_hooks";

const urls = ((globalThis as typeof globalThis & { __requestUrls?: AsyncLocalStorage<string> }).__requestUrls ??= new AsyncLocalStorage<string>());
/** The URL of the request being rendered, for pages that read their query. */
export const currentRequestUrl = () => urls.getStore();
export function runForSite<T>(request: Request, task: () => T): T {
  return urls.run(request.url, task);
}
