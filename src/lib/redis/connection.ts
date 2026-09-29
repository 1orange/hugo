import { Redis } from "ioredis";

/**
 * Redis holds what replicas share besides the database (ADR 0021): the job
 * queues, the events every web replica forwards to its browsers, the worker's
 * view of the model and OCR, and caches.
 */
export function redisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.REDIS_URL?.trim() || null;
}

export function requireRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = redisUrl(env);
  if (!url) {
    throw new Error("REDIS_URL is not set (redis://host:6379) — see .env.example");
  }
  return url;
}

/** Every key and channel starts with this, so e2e can share a Redis with dev. */
export function redisKeyPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return env.HUGO_REDIS_PREFIX?.trim() || "hugo";
}

export function redisKey(...parts: string[]): string {
  return [redisKeyPrefix(), ...parts].join(":");
}

/**
 * A new connection. BullMQ workers and subscribers each need their own; its
 * blocking commands must never time out (`maxRetriesPerRequest: null`).
 */
export function createRedisConnection(env: NodeJS.ProcessEnv = process.env): Redis {
  return new Redis(requireRedisUrl(env), { maxRetriesPerRequest: null });
}

type Holder = { commands?: Redis; opened: Redis[] };
const HOLDER_KEY = Symbol.for("hugo.redis");

function holder(): Holder {
  const global = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (global[HOLDER_KEY] ??= { opened: [] });
}

/** The process's connection for plain commands. */
export function redis(): Redis {
  const state = holder();
  state.commands ??= createRedisConnection();
  return state.commands;
}

/** A connection closed with the others on shutdown. */
export function openRedisConnection(): Redis {
  const connection = createRedisConnection();
  holder().opened.push(connection);
  return connection;
}

export async function closeRedis(): Promise<void> {
  const state = holder();
  const all = [...(state.commands ? [state.commands] : []), ...state.opened];
  state.commands = undefined;
  state.opened = [];
  await Promise.all(all.map((connection) => connection.quit().catch(() => connection.disconnect())));
}
