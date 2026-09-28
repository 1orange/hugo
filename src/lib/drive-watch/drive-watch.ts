import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canWatchChanges, type DriveClient } from "@/adapters/drive/port";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getDriveWatchChannel, saveDriveWatchChannel } from "@/adapters/store/settings";
import { isDriveConfigured, syncDriveAndQueueExtraction } from "@/lib/sweep/ensure-fresh-sweep";

/**
 * Documents are read as they arrive in Drive, not when she opens the app
 * (ADR 0020): Drive notifies the webhook, and a slow poll catches what a
 * notification missed and keeps the channel alive.
 */

/** The longest Google grants a changes channel. */
const CHANNEL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-watched a day early, so a quiet week never lets it lapse. */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
/** A client dropping twelve files causes one sweep (ADR 0003). */
export const NOTIFICATION_DEBOUNCE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;

type WatchState = { debounce?: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setInterval>; ticking?: boolean };
const STATE_KEY = Symbol.for("hugo.driveWatch");

function state(): WatchState {
  const holder = globalThis as unknown as Record<symbol, WatchState | undefined>;
  holder[STATE_KEY] ??= {};
  return holder[STATE_KEY];
}

export type ChannelOutcome = "disabled" | "watching" | "renewed";

/** Watches Drive's changes when DRIVE_WEBHOOK_URL is set; renews a channel about to lapse. */
export async function ensureDriveWatchChannel(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
  driveClient: DriveClient | null = null,
): Promise<ChannelOutcome> {
  const address = env.DRIVE_WEBHOOK_URL?.trim();
  if (!address || !isDriveConfigured(env)) {
    return "disabled";
  }
  driveClient ??= createDriveClient(env);
  if (!canWatchChanges(driveClient)) {
    return "disabled";
  }
  const current = getDriveWatchChannel();
  if (current && Date.parse(current.expiresAt) - now.getTime() > RENEW_BEFORE_MS) {
    return "watching";
  }
  const channelId = randomUUID();
  const token = randomBytes(24).toString("hex");
  const created = await driveClient.watchChanges({
    channelId,
    token,
    address,
    expiresAt: new Date(now.getTime() + CHANNEL_LIFETIME_MS),
  });
  saveDriveWatchChannel({ id: channelId, resourceId: created.resourceId, token, expiresAt: created.expiresAt });
  // Until stopped the old channel overlaps the new one; its notifications carry
  // the old token and are turned away, which costs nothing.
  if (current) {
    await driveClient.stopChannel({ channelId: current.id, resourceId: current.resourceId }).catch(() => {});
  }
  return "renewed";
}

function sameToken(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type NotificationOutcome = "accepted" | "ignored" | "rejected";

/**
 * A notification from Google, by its headers. Only the channel this app made,
 * with its token, is trusted; `sync` is the ping a new channel sends once.
 */
export function acceptDriveNotification(
  headers: { channelId: string | null; token: string | null; resourceState: string | null },
  run: () => Promise<void> = () => syncDriveAndQueueExtraction(),
  debounceMs: number = NOTIFICATION_DEBOUNCE_MS,
): NotificationOutcome {
  const channel = getDriveWatchChannel();
  if (!channel || headers.channelId !== channel.id || !sameToken(headers.token ?? "", channel.token)) {
    return "rejected";
  }
  if (headers.resourceState === "sync") {
    return "ignored";
  }
  const watch = state();
  if (!watch.debounce) {
    watch.debounce = setTimeout(() => {
      watch.debounce = undefined;
      void run().catch((error) => console.warn("[drive-watch] sync after notification failed", error));
    }, debounceMs);
    watch.debounce.unref?.();
  }
  return "accepted";
}

export function pollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DRIVE_POLL_INTERVAL_MS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_POLL_INTERVAL_MS;
}

/**
 * One background loop per process: keep the channel alive, sweep, queue.
 * Off in tests and e2e, without Drive, or with DRIVE_POLL_INTERVAL_MS=0.
 */
export function startDriveWatcher(env: NodeJS.ProcessEnv = process.env): boolean {
  const watch = state();
  const interval = pollIntervalMs(env);
  if (
    watch.poll ||
    interval === 0 ||
    env.NODE_ENV === "test" ||
    env.E2E_TEST_AUTH === "true" ||
    env.DRIVE_CLIENT === "fake" ||
    !isDriveConfigured(env)
  ) {
    return false;
  }
  const tick = async () => {
    if (watch.ticking) {
      return;
    }
    watch.ticking = true;
    try {
      await ensureDriveWatchChannel(env).catch((error) =>
        console.warn("[drive-watch] could not watch Drive changes", error),
      );
      await syncDriveAndQueueExtraction(env).catch((error) =>
        console.warn("[drive-watch] poll sync failed", error),
      );
    } finally {
      watch.ticking = false;
    }
  };
  const first = setTimeout(() => void tick(), 10_000);
  first.unref?.();
  watch.poll = setInterval(() => void tick(), interval);
  watch.poll.unref?.();
  return true;
}
