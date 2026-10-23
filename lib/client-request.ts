/** Small browser-side HTTP client for explicit TradJS render roots. */

export class ClientRequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ClientRequestError";
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: HeadersInit;
  cache?: RequestCache;
}

export function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Do not reuse a timed-out controller; each request receives fresh cancellation
 * state. External abort and timeout both cancel the underlying fetch.
 */
export async function withAbort<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: Pick<RequestOptions, "timeoutMs" | "signal"> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid HTTP timeout.");
  }
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ClientRequestError(
        "Request timed out or was cancelled.",
        0,
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Accept only JSON responses and safe error messages. A proxy error page must
 * not appear verbatim as HTML in the user-facing dialog.
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ClientRequestError(
      response.ok
        ? "Unexpected server response."
        : "Server temporarily unavailable.",
      response.status,
      response.status >= 500,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ClientRequestError(
      "Invalid response from the server.",
      response.status,
    );
  }
  if (!response.ok) {
    const object =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const message =
      typeof object.error === "string" && object.error.length < 300
        ? object.error
        : "Request failed.";
    throw new ClientRequestError(
      message,
      response.status,
      response.status >= 500 || response.status === 429,
    );
  }
  return data as T;
}

export async function getJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  return withAbort(async (signal) => {
    const response = await fetch(url, {
      method: "GET",
      cache: options.cache ?? "no-store",
      headers: options.headers,
      signal,
    });
    return parseJsonResponse<T>(response);
  }, options);
}

export async function postJson<T>(
  url: string,
  value: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return withAbort(async (signal) => {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(value),
      signal,
    });
    return parseJsonResponse<T>(response);
  }, options);
}

export async function uploadImage<T>(
  url: string,
  file: File,
  options: RequestOptions = {},
): Promise<T> {
  return withAbort(
    async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
        signal,
      });
      return parseJsonResponse<T>(response);
    },
    { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
  );
}

/** No overlapping polls: the next poll begins after the previous resolves. */
export class SequentialPoller {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly task: (signal: AbortSignal) => Promise<void>,
    private readonly intervalMs = 10_000,
    private readonly onError?: (error: unknown) => void,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs < 100) {
      throw new Error("Invalid polling interval.");
    }
  }

  start(immediately = false) {
    if (this.active) return;
    this.active = true;
    this.schedule(immediately ? 0 : this.intervalMs);
  }

  private schedule(afterMs: number) {
    if (!this.active) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.active || this.abort.signal.aborted) return;
      try {
        await this.task(this.abort.signal);
      } catch (error) {
        if (!this.abort.signal.aborted) this.onError?.(error);
      } finally {
        if (this.active && !this.abort.signal.aborted) {
          this.schedule(this.intervalMs);
        }
      }
    }, afterMs);
  }

  stop() {
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.abort.abort();
  }

  get running() {
    return this.active;
  }
}

/**
 * Some browsers reject clipboard writes without permission. Keep a selectable
 * value in the DOM even when the copy action is unavailable.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
