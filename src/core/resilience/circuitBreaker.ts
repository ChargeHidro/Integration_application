import { CircuitOpenError, isTransientError } from "../errors/errors";

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  name: string;
  failureRate: number;
  minRequests: number;
  windowMs: number;
  cooldownMs: number;
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (from: BreakerState, to: BreakerState) => void;
  now?: () => number;
}

interface Outcome {
  at: number;
  failed: boolean;
}

export class CircuitBreaker {
  private outcomes: Outcome[] = [];
  private current: BreakerState = "closed";
  private openedAt = 0;
  private probeInFlight = false;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.isFailure = options.isFailure ?? isTransientError;
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.current === "open" && this.now() - this.openedAt >= this.options.cooldownMs) return "half_open";
    return this.current;
  }

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open") throw new CircuitOpenError(this.options.name);

    const isProbe = state === "half_open";
    if (isProbe) {
      if (this.probeInFlight) throw new CircuitOpenError(this.options.name);
      this.probeInFlight = true;
      this.transition("half_open");
    }

    try {
      const result = await work();
      this.record(false, isProbe);
      return result;
    } catch (error) {
      this.record(this.isFailure(error), isProbe);
      throw error;
    } finally {
      if (isProbe) this.probeInFlight = false;
    }
  }

  private record(failed: boolean, isProbe: boolean): void {
    if (isProbe) {
      if (failed) this.open();
      else this.close();
      return;
    }
    if (this.current !== "closed") return;

    const now = this.now();
    this.outcomes = this.outcomes.filter((outcome) => now - outcome.at < this.options.windowMs);
    this.outcomes.push({ at: now, failed });

    const failures = this.outcomes.filter((outcome) => outcome.failed).length;
    if (this.outcomes.length >= this.options.minRequests && failures / this.outcomes.length >= this.options.failureRate) {
      this.open();
    }
  }

  private open(): void {
    this.openedAt = this.now();
    this.outcomes = [];
    this.transition("open");
  }

  private close(): void {
    this.outcomes = [];
    this.transition("closed");
  }

  private transition(to: BreakerState): void {
    const from = this.current;
    this.current = to;
    if (from !== to) this.options.onStateChange?.(from, to);
  }
}
