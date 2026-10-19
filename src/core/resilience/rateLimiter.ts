import type { Redis } from "ioredis";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  tryAcquire(): Promise<RateLimitDecision>;
}

export interface TokenBucketOptions {
  ratePerSecond: number;
  capacity?: number;
}

const tokenBucketScript = `
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate / 1000)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil((1 - tokens) * 1000 / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * 1000 / rate) + 1000)
return { allowed, wait }
`;

export class RedisTokenBucket implements RateLimiter {
  private readonly capacity: number;

  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly options: TokenBucketOptions,
  ) {
    this.capacity = options.capacity ?? options.ratePerSecond;
  }

  async tryAcquire(): Promise<RateLimitDecision> {
    const [allowed, wait] = (await this.redis.eval(
      tokenBucketScript,
      1,
      this.key,
      this.options.ratePerSecond,
      this.capacity,
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterMs: wait };
  }
}

export class InMemoryTokenBucket implements RateLimiter {
  private readonly capacity: number;
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly options: TokenBucketOptions,
    private readonly now: () => number = Date.now,
  ) {
    this.capacity = options.capacity ?? options.ratePerSecond;
    this.tokens = this.capacity;
    this.updatedAt = now();
  }

  async tryAcquire(): Promise<RateLimitDecision> {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (Math.max(0, now - this.updatedAt) * this.options.ratePerSecond) / 1000);
    this.updatedAt = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: Math.ceil(((1 - this.tokens) * 1000) / this.options.ratePerSecond) };
  }
}
