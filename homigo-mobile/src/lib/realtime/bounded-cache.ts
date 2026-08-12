/**
 * Bounded in-memory caches for realtime dedupe — TTL eviction + LRU cap.
 * Target: stable memory during 8h sessions (100k+ events without unbounded growth).
 */

const DEFAULT_MAX_SIZE = 2_000;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1_000; // 8 hours

/** FIFO/LRU Set with TTL — used for processed event keys. */
export class BoundedEventCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly maxSize = DEFAULT_MAX_SIZE,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  has(key: string): boolean {
    this.evictExpired();
    return this.entries.has(key);
  }

  add(key: string): void {
    this.evictExpired();
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, Date.now());
  }

  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, at] of this.entries) {
      if (now - at > this.ttlMs) this.entries.delete(key);
    }
  }
}

/** Bounded Map for monotonic timestamps (e.g. booking status ordering). */
export class BoundedTimestampMap {
  private readonly entries = new Map<string, { ts: number; at: number }>();

  constructor(
    private readonly maxSize = 500,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  get(key: string): number | undefined {
    this.evictExpired();
    return this.entries.get(key)?.ts;
  }

  set(key: string, ts: number): void {
    this.evictExpired();
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { ts, at: Date.now() });
  }

  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, { at }] of this.entries) {
      if (now - at > this.ttlMs) this.entries.delete(key);
    }
  }
}
