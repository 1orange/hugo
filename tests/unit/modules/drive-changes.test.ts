import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_LISTING_AFTER_MS,
  needsFullListing,
  snapshotWritesFor,
  type DriveChangeEntry,
} from "../../../src/modules/drive-changes.ts";

function changed(id: string, name: string, trashed = false): DriveChangeEntry {
  return {
    fileId: id,
    removed: false,
    file: { id, name, parents: ["p"], createdTime: "2026-11-01T00:00:00.000Z", mimeType: "application/pdf", trashed },
  };
}

test("a changed file is written as it is now; a trashed or removed one leaves the snapshot", () => {
  const writes = snapshotWritesFor([
    changed("a", "a.pdf"),
    changed("b", "b.pdf", true),
    { fileId: "c", removed: true, file: null },
  ]);
  assert.deepEqual(
    writes.upserts.map((file) => [file.id, file.name]),
    [["a", "a.pdf"]],
  );
  assert.equal("trashed" in writes.upserts[0]!, false, "the snapshot holds Drive records, not change entries");
  assert.deepEqual(writes.removedIds.sort(), ["b", "c"]);
});

test("a file the log names twice ends in its last state", () => {
  const renamed = snapshotWritesFor([changed("a", "old.pdf"), changed("a", "new.pdf")]);
  assert.deepEqual(renamed.upserts.map((file) => file.name), ["new.pdf"]);

  const restored = snapshotWritesFor([{ fileId: "a", removed: true, file: null }, changed("a", "back.pdf")]);
  assert.deepEqual(restored, { upserts: [restored.upserts[0]!], removedIds: [] });

  const thenTrashed = snapshotWritesFor([changed("a", "a.pdf"), changed("a", "a.pdf", true)]);
  assert.deepEqual(thenTrashed, { upserts: [], removedIds: ["a"] });
});

test("everything is listed the first time, after a day, or without a token; the log is read otherwise", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  const recent = new Date(now - 60_000).toISOString();
  assert.equal(needsFullListing({ changesToken: null, snapshotAt: null }, now), true);
  assert.equal(needsFullListing({ changesToken: null, snapshotAt: recent }, now), true);
  assert.equal(needsFullListing({ changesToken: "41", snapshotAt: recent }, now), false);
  assert.equal(
    needsFullListing({ changesToken: "41", snapshotAt: new Date(now - FULL_LISTING_AFTER_MS).toISOString() }, now),
    true,
  );
  assert.equal(needsFullListing({ changesToken: "41", snapshotAt: "not a date" }, now), true);
});
