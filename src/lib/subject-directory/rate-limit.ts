/**
 * How many register lookups a worker may make in a minute (ADR 0022). A
 * lookup refused is not lost: its document is tried again after a while.
 */
export interface LookupRateLimiter {
  /** True when a lookup may be made now, and counts it. */
  tryTake(): boolean;
  /** How long until a lookup may be made: 0 when one may be made now. */
  msUntilFree(): number;
}

export const DEFAULT_LOOKUPS_PER_MINUTE = 20;

export function lookupsPerMinute(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.SUBJECT_LOOKUPS_PER_MINUTE);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LOOKUPS_PER_MINUTE;
}

export function createLookupRateLimiter(options: { perMinute: number; now?: () => number }): LookupRateLimiter {
  const now = options.now ?? (() => Date.now());
  const window: number[] = [];
  const expire = (at: number) => {
    while (window.length > 0 && at - window[0]! >= 60_000) {
      window.shift();
    }
  };
  return {
    tryTake() {
      const at = now();
      expire(at);
      if (window.length >= options.perMinute) {
        return false;
      }
      window.push(at);
      return true;
    },
    msUntilFree() {
      const at = now();
      expire(at);
      return window.length < options.perMinute ? 0 : window[0]! + 60_000 - at;
    },
  };
}
