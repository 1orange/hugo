import { formatDateTime, formatSweepAge } from "@/modules/format-sk";

/**
 * What the queue screen's Drive panel says about Drive sync (0007/03): whether
 * push is on, when it last delivered, and whether it has gone quiet while
 * sweeps still found changes. No I/O: the loader reads the settings and env.
 */

/**
 * Push that has delivered nothing for a day, while sweeps found changes, is
 * suspect: a notification that never arrives costs up to the poll interval,
 * so the poll would have caught the change and the webhook still is not working.
 */
export const PUSH_SILENCE_MS = 24 * 60 * 60 * 1000;

export type DriveSyncInput = {
  now: Date;
  /** DRIVE_WEBHOOK_URL is set in this process's config. */
  webhookConfigured: boolean;
  /** The changes channel this app watches, if one exists. */
  channel: { startedAt: string; expiresAt: string } | null;
  /** The poll's interval in ms, or 0 when the poll is off. */
  pollIntervalMs: number;
  lastNotificationAt: string | null;
  /** The last sweep that wrote changed files. */
  lastChangeAt: string | null;
  lastSweepAt: string | null;
};

export type DriveSyncPanel = {
  mode: "push" | "poll";
  modeLabel: string;
  /** Push only: when the channel stops, and Google needs it renewed. */
  channelExpiryLabel: string | null;
  pollLabel: string;
  lastNotificationLabel: string;
  lastSweepLabel: string;
  /** Push is on and has gone quiet while changes were found: see isPushSilent. */
  silent: boolean;
};

/**
 * Silent when push is on, nothing has arrived for PUSH_SILENCE_MS, and a sweep
 * since that point wrote changes. `since` is the last accepted notification,
 * or the channel's start when none has arrived, so a brand-new channel is not
 * suspect for a day.
 */
export function isPushSilent(input: {
  pushOn: boolean;
  now: Date;
  since: string | null;
  lastChangeAt: string | null;
}): boolean {
  if (!input.pushOn || !input.since || !input.lastChangeAt) {
    return false;
  }
  const sinceMs = Date.parse(input.since);
  const changeMs = Date.parse(input.lastChangeAt);
  if (Number.isNaN(sinceMs) || Number.isNaN(changeMs)) {
    return false;
  }
  return input.now.getTime() - sinceMs > PUSH_SILENCE_MS && changeMs > sinceMs;
}

/** "pred 4 min", "pred 3 h", or the date once it is a day or more old. */
export function formatNotificationAge(iso: string | null, now: Date): string {
  if (!iso) {
    return "zatiaľ žiadna";
  }
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return "zatiaľ žiadna";
  }
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) {
    return "pred chvíľou";
  }
  if (minutes < 60) {
    return `pred ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `pred ${hours} h`;
  }
  return formatDateTime(iso);
}

export function driveSyncPanel(input: DriveSyncInput): DriveSyncPanel {
  const pushOn = input.webhookConfigured && input.channel !== null;
  const pollMinutes = input.pollIntervalMs > 0 ? Math.round(input.pollIntervalMs / 60_000) : null;
  const pollLabel = pollMinutes === null ? "vypnutá" : `každých ${pollMinutes} min`;

  return {
    mode: pushOn ? "push" : "poll",
    modeLabel: pushOn
      ? "Push zapnutý"
      : pollMinutes === null
        ? "Iba pravidelná kontrola, vypnutá"
        : `Iba pravidelná kontrola každých ${pollMinutes} min`,
    channelExpiryLabel: pushOn && input.channel ? formatDateTime(input.channel.expiresAt) : null,
    pollLabel,
    lastNotificationLabel: formatNotificationAge(input.lastNotificationAt, input.now),
    lastSweepLabel: formatSweepAge(input.lastSweepAt, input.now),
    silent: isPushSilent({
      pushOn,
      now: input.now,
      since: input.lastNotificationAt ?? input.channel?.startedAt ?? null,
      lastChangeAt: input.lastChangeAt,
    }),
  };
}
