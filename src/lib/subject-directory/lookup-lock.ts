import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { redis, redisKey, redisUrl } from "@/lib/redis/connection";

/**
 * One register lookup in flight per subject, across every replica (ADR 0022):
 * the first caller holds the key, the others wait for it to be released and
 * then read what it stored instead of asking the register again.
 */
export interface LookupLock {
  /** A token when the key was free and is now the caller's; null when someone else holds it. */
  tryAcquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
  /** Resolves once the key is free, or after `timeoutMs`, whichever comes first. */
  waitUntilFree(key: string, timeoutMs: number): Promise<void>;
}

type Holder = { token: string; released: Promise<void>; free: () => void };

/** Within one process: a promise per held key, which the waiters share. */
export class InProcessLookupLock implements LookupLock {
  private readonly holders = new Map<string, Holder>();

  async tryAcquire(key: string): Promise<string | null> {
    if (this.holders.has(key)) {
      return null;
    }
    const token = randomUUID();
    let free: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      free = resolve;
    });
    this.holders.set(key, { token, released, free });
    return token;
  }

  async release(key: string, token: string): Promise<void> {
    const holder = this.holders.get(key);
    if (!holder || holder.token !== token) {
      return;
    }
    this.holders.delete(key);
    holder.free();
  }

  async waitUntilFree(key: string, timeoutMs: number): Promise<void> {
    const holder = this.holders.get(key);
    if (!holder) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      holder.released,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }
}

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const WAIT_POLL_MS = 250;

/** Across replicas: SET NX PX, released only by the holder's token. */
export class RedisLookupLock implements LookupLock {
  constructor(private readonly client: Redis) {}

  async tryAcquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const reply = await this.client.set(redisKey("subject-lookup", key), token, "PX", ttlMs, "NX");
    return reply === "OK" ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, 1, redisKey("subject-lookup", key), token);
  }

  async waitUntilFree(key: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.client.exists(redisKey("subject-lookup", key))) === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    }
  }
}

const sharedInProcessLock = new InProcessLookupLock();

/** Redis when REDIS_URL is set; otherwise one lock per process (tests, and a single process). */
export function createLookupLock(): LookupLock {
  if (redisUrl()) {
    return new RedisLookupLock(redis());
  }
  return sharedInProcessLock;
}
