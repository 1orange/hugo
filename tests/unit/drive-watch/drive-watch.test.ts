import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import type { DriveChangesWatch } from "../../../src/adapters/drive/port.ts";
import { getDriveWatchChannel, saveDriveWatchChannel } from "../../../src/adapters/store/settings.ts";
import { runMigrations, resetDbForTests } from "../../../src/lib/db/migrate.ts";
import {
  acceptDriveNotification,
  ensureDriveWatchChannel,
  pollIntervalMs,
  startDriveWatcher,
} from "../../../src/lib/drive-watch/drive-watch.ts";

function freshDb(): void {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hugo-watch-")), "test.db");
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
}

class WatchingDrive extends FakeDriveClient implements DriveChangesWatch {
  readonly watched: string[] = [];
  readonly stopped: string[] = [];
  constructor() {
    super([], {});
  }
  async watchChanges(input: { channelId: string; expiresAt: Date }) {
    this.watched.push(input.channelId);
    return { resourceId: `resource-${input.channelId}`, expiresAt: input.expiresAt.toISOString() };
  }
  async stopChannel(input: { channelId: string }) {
    this.stopped.push(input.channelId);
  }
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

const ENV = env({ DRIVE_CLIENT: "fake", DRIVE_WEBHOOK_URL: "https://hugo.example.eu/api/drive/notifications" });
const DAY = 24 * 60 * 60 * 1000;

test("without a webhook URL the app does not watch Drive", async () => {
  freshDb();
  const drive = new WatchingDrive();
  assert.equal(await ensureDriveWatchChannel(env({ DRIVE_CLIENT: "fake" }), new Date(), drive), "disabled");
  assert.deepEqual(drive.watched, []);
});

test("a channel is made once, kept while it has more than a day, renewed after", async () => {
  freshDb();
  const drive = new WatchingDrive();
  const start = new Date("2026-09-01T00:00:00Z");
  assert.equal(await ensureDriveWatchChannel(ENV, start, drive), "renewed");
  const first = getDriveWatchChannel()!;
  assert.equal(Date.parse(first.expiresAt) - start.getTime(), 7 * DAY);

  assert.equal(await ensureDriveWatchChannel(ENV, new Date(start.getTime() + 5 * DAY), drive), "watching");
  assert.equal(drive.watched.length, 1);

  // Less than a day left: a new channel, and the old one stopped.
  assert.equal(await ensureDriveWatchChannel(ENV, new Date(start.getTime() + 6.5 * DAY), drive), "renewed");
  const second = getDriveWatchChannel()!;
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.token, first.token);
  assert.deepEqual(drive.stopped, [first.id]);
});

test("only this app's channel, with its token, is trusted", () => {
  freshDb();
  saveDriveWatchChannel({ id: "channel-1", resourceId: "r", token: "secret-token", expiresAt: "2026-09-08T00:00:00Z" });
  const never = async () => assert.fail("must not sync");
  assert.equal(acceptDriveNotification({ channelId: "other", token: "secret-token", resourceState: "change" }, never), "rejected");
  assert.equal(acceptDriveNotification({ channelId: "channel-1", token: "guess", resourceState: "change" }, never), "rejected");
  assert.equal(acceptDriveNotification({ channelId: "channel-1", token: null, resourceState: "change" }, never), "rejected");
  // A new channel's first ping says nothing changed.
  assert.equal(acceptDriveNotification({ channelId: "channel-1", token: "secret-token", resourceState: "sync" }, never), "ignored");
});

test("a burst of notifications causes one sync", async () => {
  freshDb();
  saveDriveWatchChannel({ id: "channel-1", resourceId: "r", token: "secret-token", expiresAt: "2026-09-08T00:00:00Z" });
  let syncs = 0;
  const run = async () => {
    syncs += 1;
  };
  for (let file = 0; file < 12; file += 1) {
    assert.equal(
      acceptDriveNotification({ channelId: "channel-1", token: "secret-token", resourceState: "change" }, run, 20),
      "accepted",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(syncs, 1);
});

test("the poll runs every 15 minutes unless set, and never in tests or without Drive", () => {
  assert.equal(pollIntervalMs(env({})), 15 * 60 * 1000);
  assert.equal(pollIntervalMs(env({ DRIVE_POLL_INTERVAL_MS: "60000" })), 60000);
  assert.equal(pollIntervalMs(env({ DRIVE_POLL_INTERVAL_MS: "0" })), 0);
  assert.equal(startDriveWatcher(env({ NODE_ENV: "test", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" })), false);
  assert.equal(startDriveWatcher(env({ NODE_ENV: "production" })), false);
  assert.equal(startDriveWatcher(env({ NODE_ENV: "production", GOOGLE_SERVICE_ACCOUNT_JSON: "{}", DRIVE_POLL_INTERVAL_MS: "0" })), false);
});
