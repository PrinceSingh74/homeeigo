/**
 * Dependency-free circuit breaker for external dependencies (Google Maps,
 * Razorpay, Redis, Email, SMS). Isolates failures so a flaky/down upstream
 * fast-fails instead of piling up timeouts and exhausting the event loop.
 *
 * States: CLOSED → (failures ≥ threshold) → OPEN → (after resetTimeout) →
 * HALF_OPEN → (trial success) → CLOSED | (trial failure) → OPEN.
 *
 * Emits Prometheus metrics:
 *   circuit_breaker_state{breaker}        0=closed 1=half_open 2=open  (gauge)
 *   circuit_breaker_trips_total{breaker}                              (counter)
 *   circuit_breaker_short_circuit_total{breaker}                      (counter)
 */
import { incCounter, setGauge } from "./metrics";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`circuit_open:${name}`);
    this.name = "CircuitOpenError";
  }
}

export interface BreakerOptions {
  failureThreshold?: number; // consecutive failures before opening
  resetTimeoutMs?: number; // how long to stay OPEN before a trial
  halfOpenMaxAttempts?: number; // concurrent trial calls allowed in HALF_OPEN
}

const STATE_CODE: Record<CircuitState, number> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxAttempts: number;

  constructor(name: string, opts: BreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 1;
    this.publishState();
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  /** Run `fn` through the breaker. Throws CircuitOpenError immediately when OPEN. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();

    if (this.state === "OPEN") {
      incCounter("circuit_breaker_short_circuit_total", { breaker: this.name });
      throw new CircuitOpenError(this.name);
    }
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenInFlight >= this.halfOpenMaxAttempts) {
        incCounter("circuit_breaker_short_circuit_total", { breaker: this.name });
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenInFlight += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      if (this.state === "HALF_OPEN" && this.halfOpenInFlight > 0) this.halfOpenInFlight -= 1;
    }
  }

  /** Optional fallback variant — returns `fallback` instead of throwing when the call fails/opens. */
  async executeOr<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await this.execute(fn);
    } catch {
      return fallback;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state !== "CLOSED") this.transition("CLOSED");
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.openedAt = Date.now();
    if (this.state !== "OPEN") {
      this.transition("OPEN");
      incCounter("circuit_breaker_trips_total", { breaker: this.name });
    }
  }

  private maybeHalfOpen(): void {
    if (this.state === "OPEN" && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.transition("HALF_OPEN");
      this.halfOpenInFlight = 0;
    }
  }

  private transition(next: CircuitState): void {
    this.state = next;
    this.publishState();
  }

  private publishState(): void {
    setGauge("circuit_breaker_state", STATE_CODE[this.state], { breaker: this.name });
  }
}

/** Central registry so every external dependency has one shared breaker. */
class BreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();
  get(name: string, opts?: BreakerOptions): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(name, opts);
      this.breakers.set(name, b);
    }
    return b;
  }
  all(): CircuitBreaker[] {
    return [...this.breakers.values()];
  }
}

export const breakers = new BreakerRegistry();

// Pre-register the five external dependencies so their state gauges publish at 0 (CLOSED) on boot.
export const mapsBreaker = breakers.get("google_maps", { failureThreshold: 5, resetTimeoutMs: 30_000 });
export const razorpayBreaker = breakers.get("razorpay", { failureThreshold: 5, resetTimeoutMs: 20_000 });
export const redisBreaker = breakers.get("redis", { failureThreshold: 10, resetTimeoutMs: 10_000 });
export const emailBreaker = breakers.get("email", { failureThreshold: 5, resetTimeoutMs: 60_000 });
export const smsBreaker = breakers.get("sms", { failureThreshold: 5, resetTimeoutMs: 60_000 });
export const weatherBreaker = breakers.get("openweather", { failureThreshold: 5, resetTimeoutMs: 30_000 });
