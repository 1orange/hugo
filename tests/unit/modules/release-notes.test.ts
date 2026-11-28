import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasUnreadReleaseNotes,
  latestReleaseNoteId,
  RELEASE_NOTES,
  releaseNotesSeenKey,
  type ReleaseNote,
} from "../../../src/modules/release-notes.ts";

test("the notes are newest first, with unique ids that start with their date, and none empty", () => {
  const ids = RELEASE_NOTES.map((note) => note.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.deepEqual(ids, [...ids].sort().reverse(), "newest first");
  for (const note of RELEASE_NOTES) {
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(note.id.startsWith(note.date), note.id);
    assert.ok(note.items.length > 0 && note.items.every((item) => item.title && item.text), note.id);
  }
});

test("a note newer than the one last seen is unread; nothing seen means everything is new", () => {
  const notes: ReleaseNote[] = [
    { id: "2026-12-01", date: "2026-12-01", title: "B", items: [{ title: "x", text: "y" }] },
    { id: "2026-11-24", date: "2026-11-24", title: "A", items: [{ title: "x", text: "y" }] },
  ];
  assert.equal(latestReleaseNoteId(notes), "2026-12-01");
  assert.equal(hasUnreadReleaseNotes(null, notes), true);
  assert.equal(hasUnreadReleaseNotes("2026-11-24", notes), true);
  assert.equal(hasUnreadReleaseNotes("2026-12-01", notes), false);
  assert.equal(hasUnreadReleaseNotes(null, []), false, "no notes, no dot");
  assert.equal(latestReleaseNoteId([]), null);
});

test("what was seen is kept per signed-in email, whatever its case", () => {
  assert.equal(releaseNotesSeenKey(" Eva@Kancelaria.sk "), releaseNotesSeenKey("eva@kancelaria.sk"));
  assert.notEqual(releaseNotesSeenKey("eva@kancelaria.sk"), releaseNotesSeenKey("jana@kancelaria.sk"));
});
