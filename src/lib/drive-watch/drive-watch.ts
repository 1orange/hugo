import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canWatchChanges, type DriveClient } from "@/adapters/drive/port";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getDriveWatchChannel, saveDriveWatchChannel } from "@/adapters/store/settings";
import { sweepQueue } from "@/adapters/job-queue/bullmq-queues";
import { isDriveConfigured } from "@/lib/sweep/ensure-fresh-sweep";

/**
 * Documents are read as they arrive in Drive, not when she opens the app
 * (ADR 0020): Drive notifies the webhook, and a slow poll catches what a
 * notification missed and keeps the channel alive. Both are jobs on the sweep
 * queue (ADR 0021), so however many replicas there are, one sweep runs.
 */

/** The longest Google grants a changes channel. */
const CHANNEL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-watched a day early, so a quiet week never lets it lapse. */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
/** A client dropping twelve files causes one sweep (ADR 0003). */
export const NOTIFICATION_DEBOUNCE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;
const POLL_SCHEDULER_ID = "drive-poll";

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
  const current = await getDriveWatchChannel();
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
  await saveDriveWatchChannel({ id: channelId, resourceId: created.resourceId, token, expiresAt: created.expiresAt });
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
 * An accepted one asks for a sweep (`requestDriveSync`).
 */
export async function acceptDriveNotification(
  headers: { channelId: string | null; token: string | null; resourceState: string | null },
  requestSync: () => Promise<void> = requestDriveSync,
): Promise<NotificationOutcome> {
  const channel = await getDriveWatchChannel();
  if (!channel || headers.channelId !== channel.id || !sameToken(headers.token ?? "", channel.token)) {
    return "rejected";
  }
  if (headers.resourceState === "sync") {
    return "ignored";
  }
  await requestSync();
  return "accepted";
}

/**
 * One sweep, 30 s after the first notification of a burst: a client dropping
 * twelve files causes one sweep (ADR 0003). The queue drops the others, on
 * whichever replica Google reached.
 */
export async function requestDriveSync(): Promise<void> {
  await sweepQueue().add(
    "notified",
    {},
    {
      delay: NOTIFICATION_DEBOUNCE_MS,
      deduplication: { id: "drive-notified", ttl: NOTIFICATION_DEBOUNCE_MS },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export function pollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DRIVE_POLL_INTERVAL_MS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_POLL_INTERVAL_MS;
}

/** Off in tests and e2e, without Drive, or with DRIVE_POLL_INTERVAL_MS=0. */
export function drivePollEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    pollIntervalMs(env) > 0 &&
    env.NODE_ENV !== "test" &&
    env.E2E_TEST_AUTH !== "true" &&
    env.DRIVE_CLIENT !== "fake" &&
    isDriveConfigured(env)
  );
}

/**
 * The poll as a job scheduler: every worker sets the same one, and BullMQ
 * runs it once per interval for all of them. A first sweep follows start-up,
 * for what arrived while nothing was running.
 */
export async function scheduleDrivePoll(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const queue = sweepQueue();
  if (!drivePollEnabled(env)) {
    await queue.removeJobScheduler(POLL_SCHEDULER_ID);
    return false;
  }
  await queue.upsertJobScheduler(
    POLL_SCHEDULER_ID,
    { every: pollIntervalMs(env) },
    { name: "poll", opts: { removeOnComplete: true, removeOnFail: true } },
  );
  await queue.add(
    "poll",
    {},
    {
      delay: 10_000,
      deduplication: { id: "startup-poll", ttl: 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
  return true;
}
