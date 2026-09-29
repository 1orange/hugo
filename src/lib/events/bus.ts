import { EventEmitter } from "node:events";
import { openRedisConnection, redis, redisKey, redisUrl } from "@/lib/redis/connection";

/**
 * What the screens need to hear about (ADR 0021). Published by whichever
 * process caused it — a worker that read a document, any replica that swept
 * Drive — and forwarded by every web replica to its browsers (/api/events).
 * Not the audit trail: that stays the events table (ADR 0012).
 */
export type AppEvent =
  /** Something in the extraction queue moved; the screens ask for its snapshot. */
  | { type: "queue-changed" }
  | {
      type: "document-read";
      companyId: number;
      monthKey: string;
      driveFileId: string;
      outcome: "complete" | "failed";
    }
  /** A sweep found files added, moved, renamed or gone in these months. */
  | { type: "files-changed"; months: Array<{ companyId: number; monthKey: string }> }
  /** The model's or OCR's state, as the worker sees it, changed. */
  | { type: "services-changed" };

export type AppEventListener = (event: AppEvent) => void;

type BusState = {
  local: EventEmitter;
  subscribed?: Promise<void>;
};

const STATE_KEY = Symbol.for("hugo.eventBus");
const LOCAL_EVENT = "app-event";

function state(): BusState {
  const global = globalThis as unknown as Record<symbol, BusState | undefined>;
  if (!global[STATE_KEY]) {
    const local = new EventEmitter();
    // One listener per open browser tab.
    local.setMaxListeners(0);
    global[STATE_KEY] = { local };
  }
  return global[STATE_KEY];
}

function channel(): string {
  return redisKey("events");
}

/**
 * Without REDIS_URL (unit tests) events stay in this process, which is all a
 * single process needs.
 */
export async function publishAppEvent(event: AppEvent): Promise<void> {
  if (!redisUrl()) {
    state().local.emit(LOCAL_EVENT, event);
    return;
  }
  await redis().publish(channel(), JSON.stringify(event));
}

/** Publishes without waiting; a lost screen update is not worth failing the work that caused it. */
export function announce(event: AppEvent): void {
  publishAppEvent(event).catch((error: unknown) => console.warn("[events] could not publish", event.type, error));
}

/**
 * One Redis subscription per process, fanned out to every listener here.
 * Returns the unsubscribe.
 */
export function subscribeAppEvents(listener: AppEventListener): () => void {
  const bus = state();
  bus.local.on(LOCAL_EVENT, listener);
  if (redisUrl() && !bus.subscribed) {
    const subscriber = openRedisConnection();
    subscriber.on("message", (_channel: string, message: string) => {
      try {
        bus.local.emit(LOCAL_EVENT, JSON.parse(message) as AppEvent);
      } catch (error) {
        console.warn("[events] unreadable message", error);
      }
    });
    bus.subscribed = subscriber.subscribe(channel()).then(() => undefined);
    bus.subscribed.catch((error: unknown) => {
      console.warn("[events] could not subscribe", error);
      bus.subscribed = undefined;
    });
  }
  return () => {
    bus.local.off(LOCAL_EVENT, listener);
  };
}
