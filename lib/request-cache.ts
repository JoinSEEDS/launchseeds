/**
 * Bounded in-process coalescing for expensive *read-only* upstream requests.
 * The cache is a load-shedding optimization, not a source of financial truth.
 * Every entry retains the source's original observation timestamp.
 */
export interface CachedObservation<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export class RequestCache<T> {
  private readonly entries = new Map<string, CachedObservation<T>>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(
    readonly ttlMs: number,
    readonly capacity: number = 512,
  ) {
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 60_000 ||
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 10_000
    )
      throw new Error("Invalid request cache limits.");
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Concurrent readers of the same key await the same task, even if the
   * first request ultimately fails. A failure is never stored as a success.
   * The explicit timestamp allows deterministic tests and clock validation.
   */
  async get(
    key: string,
    loader: () => Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    if (!key || key.length > 512 || !Number.isSafeInteger(now) || now < 0)
      throw new Error("Invalid cache lookup.");
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) return existing.value;
    const active = this.pending.get(key);
    if (active) return active;
    // Do not close over a previous observation's timestamp when recording a
    // successful network response. Otherwise a slow query could expire before
    // it has finished and provoke a request stampede.
    const task = (async () => {
      const result = await loader();
      const resolvedAt = Date.now();
      this.prune(resolvedAt);
      this.entries.delete(key);
      this.entries.set(key, {
        value: result,
        createdAt: resolvedAt,
        expiresAt: resolvedAt + this.ttlMs,
      });
      return result;
    })();
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
  get size(): number {
    return this.entries.size;
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  inspect(key: string, now = Date.now()): CachedObservation<T> | null {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > now ? { ...entry } : null;
  }
}
