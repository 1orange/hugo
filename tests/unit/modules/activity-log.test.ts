import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  eventMonthKey,
  formatActivityEntry,
  summarizeEventPayload,
} from "../../../src/modules/activity-log.ts";
import type { DomainEvent } from "../../../src/modules/drive-tree.ts";

test("every known event type has a human-readable label", () => {
  for (const type of ALL_EVENT_TYPES) {
    const label = EVENT_TYPE_LABELS[type];
    assert.ok(label, `missing label for ${type}`);
    assert.notEqual(label, type);
  }
});

test("eventMonthKey derives month from payload shapes and returns null honestly", () => {
  assert.equal(
    eventMonthKey("FileDiscovered", {
      monthKey: "2026_02",
    }),
    "2026_02",
  );
  assert.equal(
    eventMonthKey("MonthClosed", { monthKey: "2026_03" }),
    "2026_03",
  );
  assert.equal(
    eventMonthKey("FileRenamedInDrive", {
      previousName: "a.pdf",
      newName: "b.pdf",
    }),
    null,
  );
  assert.equal(eventMonthKey("CanonicalFolderNamesChanged", { previous: {}, next: {} }), null);
});

test("summarizeEventPayload describes drive mutations with previous values", () => {
  assert.match(
    summarizeEventPayload("Renamed", {
      previousName: "04 Bločky_hotorvosť",
      newName: "04 Bločky_hotovosť",
      driveFileId: "folder-1",
    }),
    /04 Bločky_hotorvosť/,
  );
  assert.match(
    summarizeEventPayload("Renamed", {
      previousName: "04 Bločky_hotovosť",
      newName: "04 Bločky_hotorvosť",
      undone: true,
    }),
    /vrátené/i,
  );
  assert.match(
    summarizeEventPayload("FileRenamedInDrive", {
      previousName: "old.pdf",
      newName: "new.pdf",
    }),
    /old\.pdf/,
  );
});

test("summarizeEventPayload includes extraction source when present", () => {
  assert.match(
    summarizeEventPayload("Extracted", {
      driveFileId: "doc-1",
      source: "lookup",
    }),
    /Finančná správa/,
  );
  assert.match(
    summarizeEventPayload("Extracted", {
      driveFileId: "doc-1",
      source: "text-layer",
    }),
    /text PDF/i,
  );
  assert.match(
    summarizeEventPayload("Extracted", {
      driveFileId: "doc-1",
      source: "model",
    }),
    /model/i,
  );
});

test("formatActivityEntry surfaces first-seen time for discoveries", () => {
  const entry = formatActivityEntry({
    id: 1,
    timestamp: "2026-02-05T10:00:00.000Z",
    companyId: 1,
    actor: "system",
    type: "FileDiscovered",
    payloadJson: JSON.stringify({
      type: "FileDiscovered",
      driveFileId: "file-supplier-a",
      companyDriveFolderId: "company-folder",
      monthKey: "2026_02",
      folderSlot: "02 Prijaté faktúry",
      name: "supplier-a.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-02-05T09:30:00.000Z",
      firstSeenAt: "2026-02-05T09:30:00.000Z",
    } satisfies DomainEvent),
  });

  assert.equal(entry.actorLabel, "Systém");
  assert.match(entry.summary, /supplier-a\.pdf/);
  assert.match(entry.summary, /05\.02\.2026 10:30/);
  assert.equal(entry.monthKey, "2026_02");
});
