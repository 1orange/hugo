import { getDriveWatchChannel, getSettings } from "@/adapters/store/settings";
import { driveSyncPanel, type DriveSyncPanel } from "@/modules/drive-sync";
import { CHANNEL_LIFETIME_MS, drivePollEnabled, pollIntervalMs } from "./drive-watch";

/**
 * The queue screen's Drive panel, read from the settings and this process's
 * config (0007/03). The webhook URL is the web replica's: it is where Google
 * sends notifications, so the panel is right on whichever replica serves it.
 */
export async function loadDriveSyncPanel(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<DriveSyncPanel> {
  const [settings, channel] = await Promise.all([getSettings(), getDriveWatchChannel()]);
  // The channel is made with a full week's lifetime, so its start is its expiry less that.
  const expiresMs = channel ? Date.parse(channel.expiresAt) : Number.NaN;
  const startedAt = Number.isNaN(expiresMs) ? null : new Date(expiresMs - CHANNEL_LIFETIME_MS).toISOString();
  return driveSyncPanel({
    now,
    webhookConfigured: Boolean(env.DRIVE_WEBHOOK_URL?.trim()),
    channel: channel && startedAt ? { startedAt, expiresAt: channel.expiresAt } : null,
    pollIntervalMs: drivePollEnabled(env) ? pollIntervalMs(env) : 0,
    lastNotificationAt: settings.driveLastNotificationAt,
    lastChangeAt: settings.driveLastChangeAt,
    lastSweepAt: settings.lastSweepAt,
  });
}
