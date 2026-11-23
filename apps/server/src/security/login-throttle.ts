/**
 * Failed-login throttling: after MAX_FAILURES wrong passwords for the same
 * username from the same IP within WINDOW_MS, that pair is locked out for
 * LOCKOUT_MS (429 + Retry-After). A wider per-IP cap catches one client trying
 * many usernames. A successful login clears the pair's count.
 *
 * In-memory: right for a single API process. If the API is ever scaled out,
 * move this (and @fastify/rate-limit's store) to Redis or Postgres.
 */
export interface ThrottleOptions {
  maxFailures: number;
  /** Failures from one IP (any username) before that IP is locked out. */
  maxFailuresPerIp: number;
  windowMs: number;
  lockoutMs: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  maxFailures: 5,
  maxFailuresPerIp: 20,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
};

interface Entry {
  failures: number[]; // timestamps within the window
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly opts: ThrottleOptions = DEFAULT_THROTTLE,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until this client may try again, or 0 if not locked out. */
  retryAfter(ip: string, username: string): number {
    const t = this.now();
    const until = Math.max(this.get(pairKey(ip, username))?.lockedUntil ?? 0, this.get(ipKey(ip))?.lockedUntil ?? 0);
    return until > t ? Math.ceil((until - t) / 1000) : 0;
  }

  /** Record a wrong password; returns seconds locked out (0 if not yet). */
  fail(ip: string, username: string): number {
    this.bump(pairKey(ip, username), this.opts.maxFailures);
    this.bump(ipKey(ip), this.opts.maxFailuresPerIp);
    this.prune();
    return this.retryAfter(ip, username);
  }

  /** Successful login: forget this pair's failures (the per-IP count stays). */
  succeed(ip: string, username: string): void {
    this.entries.delete(pairKey(ip, username));
  }

  private bump(key: string, max: number) {
    const t = this.now();
    const e = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    e.failures = e.failures.filter((f) => t - f < this.opts.windowMs);
    e.failures.push(t);
    if (e.failures.length >= max) {
      e.lockedUntil = t + this.opts.lockoutMs;
      e.failures = [];
    }
    this.entries.set(key, e);
  }

  private get(key: string): Entry | undefined {
    return this.entries.get(key);
  }

  /** Drop stale entries so the map can't grow without bound. */
  private prune() {
    if (this.entries.size < 10_000) return;
    const t = this.now();
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= t && e.failures.every((f) => t - f >= this.opts.windowMs)) this.entries.delete(k);
    }
  }
}

const pairKey = (ip: string, username: string) => `u:${ip}:${username.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;
