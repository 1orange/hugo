import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateTime } from "../../../src/modules/format-sk.ts";
import {
  driveSyncPanel,
  formatNotificationAge,
  isPushSilent,
  PUSH_SILENCE_MS,
  type DriveSyncInput,
} from "../../../src/modules/drive-sync.ts";

const NOW = new Date("2026-11-23T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const POLL_15 = 15 * 60 * 1000;

function input(overrides: Partial<DriveSyncInput> = {}): DriveSyncInput {
  return {
    now: NOW,
    webhookConfigured: true,
    channel: { startedAt: ago(24 * 6), expiresAt: "2026-11-30T12:00:00.000Z" },
    pollIntervalMs: POLL_15,
    lastNotificationAt: ago(1),
    lastChangeAt: ago(1),
    lastSweepAt: ago(0.1),
    ...overrides,
  };
}

test("push is suspect when nothing arrived for more than a day and a sweep since then changed files", () => {
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: ago(25), lastChangeAt: ago(2) }), true);
  assert.equal(PUSH_SILENCE_MS, 24 * HOUR);
});

test("push is not suspect when it is off, recent, unchanged or has no change to show", () => {
  // Exactly a day is not more than a day.
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: ago(24), lastChangeAt: ago(2) }), false);
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: ago(23), lastChangeAt: ago(2) }), false);
  // Push off: the poll alone is what the screen shows, nothing to warn about.
  assert.equal(isPushSilent({ pushOn: false, now: NOW, since: ago(25), lastChangeAt: ago(2) }), false);
  // The only change came before the last notification: nothing has been missed since.
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: ago(25), lastChangeAt: ago(30) }), false);
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: ago(25), lastChangeAt: null }), false);
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: null, lastChangeAt: ago(2) }), false);
  assert.equal(isPushSilent({ pushOn: true, now: NOW, since: "not a time", lastChangeAt: ago(2) }), false);
});

test("a new channel with no notification yet is not suspect until a day has passed since it started", () => {
  const fresh = driveSyncPanel(input({ lastNotificationAt: null, lastChangeAt: ago(1), channel: { startedAt: ago(3), expiresAt: "2026-11-30T12:00:00.000Z" } }));
  assert.equal(fresh.silent, false);

  const old = driveSyncPanel(input({ lastNotificationAt: null, lastChangeAt: ago(1), channel: { startedAt: ago(30), expiresAt: "2026-11-30T12:00:00.000Z" } }));
  assert.equal(old.silent, true);
});

test("without a webhook URL the panel is poll only, with the interval and no expiry", () => {
  const panel = driveSyncPanel(input({ webhookConfigured: false }));
  assert.equal(panel.mode, "poll");
  assert.equal(panel.modeLabel, "Iba pravidelná kontrola každých 15 min");
  assert.equal(panel.channelExpiryLabel, null);
  assert.equal(panel.pollLabel, "každých 15 min");
  assert.equal(panel.silent, false);
});

test("a webhook URL without a channel is still poll only: Google has nothing to call", () => {
  const panel = driveSyncPanel(input({ channel: null }));
  assert.equal(panel.mode, "poll");
  assert.equal(panel.channelExpiryLabel, null);
});

test("with a webhook URL and a channel the panel is push, with the channel's expiry", () => {
  const panel = driveSyncPanel(input());
  assert.equal(panel.mode, "push");
  assert.equal(panel.modeLabel, "Push zapnutý");
  assert.equal(panel.channelExpiryLabel, formatDateTime("2026-11-30T12:00:00.000Z"));
  assert.equal(panel.pollLabel, "každých 15 min", "the poll still runs under push");
});

test("with the poll off and no push the panel says so", () => {
  const panel = driveSyncPanel(input({ webhookConfigured: false, pollIntervalMs: 0 }));
  assert.equal(panel.modeLabel, "Iba pravidelná kontrola, vypnutá");
  assert.equal(panel.pollLabel, "vypnutá");
});

test("the last notification reads as an age, and 'none yet' before the first", () => {
  assert.equal(formatNotificationAge(null, NOW), "zatiaľ žiadna");
  assert.equal(formatNotificationAge("garbage", NOW), "zatiaľ žiadna");
  assert.equal(formatNotificationAge(new Date(NOW.getTime() - 30_000).toISOString(), NOW), "pred chvíľou");
  assert.equal(formatNotificationAge(minutesAgo(4), NOW), "pred 4 min");
  assert.equal(formatNotificationAge(ago(3), NOW), "pred 3 h");
  assert.equal(formatNotificationAge(ago(50), NOW), formatDateTime(ago(50)));
});

test("the panel reports the last sweep, and says so when there has been none", () => {
  assert.equal(driveSyncPanel(input({ lastSweepAt: null })).lastSweepLabel, "Drive ešte nebol načítaný");
  assert.equal(driveSyncPanel(input({ lastSweepAt: minutesAgo(4) })).lastSweepLabel, "Drive načítaný pred 4 minútami");
});

test("the panel is silent when the rule says so, with push on", () => {
  const panel = driveSyncPanel(input({ lastNotificationAt: ago(26), lastChangeAt: ago(2) }));
  assert.equal(panel.mode, "push");
  assert.equal(panel.silent, true);
});
