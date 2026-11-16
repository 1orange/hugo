import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_EVENT_TYPES,
  GLOBAL_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  formatActivityEntry,
} from "../../../src/modules/activity-log.ts";

test("a subject correction is a global event with a Slovak label", () => {
  assert.ok((GLOBAL_EVENT_TYPES as readonly string[]).includes("SubjectCorrected"));
  assert.ok((ALL_EVENT_TYPES as readonly string[]).includes("SubjectCorrected"));
  assert.equal(EVENT_TYPE_LABELS.SubjectCorrected, "Subjekt v adresári opravený");
});

test("a correction reads as the subject, the field, and the value it changed from and to", () => {
  const entry = formatActivityEntry({
    id: 7,
    timestamp: "2026-11-11T10:00:00.000Z",
    companyId: null,
    actor: "user",
    type: "SubjectCorrected",
    payloadJson: JSON.stringify({
      subjectId: 3,
      subjectName: "Slovnaft, a. s.",
      field: "icDph",
      previous: "SK2020322832",
      next: "SK2020322899",
    }),
  });

  assert.equal(entry.typeLabel, "Subjekt v adresári opravený");
  assert.equal(entry.summary, "Slovnaft, a. s. — IČ DPH: „SK2020322832“ → „SK2020322899“");
  assert.equal(entry.monthKey, null);
});

test("a correction that cleared a value reads with a dash for the empty side", () => {
  const entry = formatActivityEntry({
    id: 8,
    timestamp: "2026-11-11T10:00:00.000Z",
    companyId: null,
    actor: "user",
    type: "SubjectCorrected",
    payloadJson: JSON.stringify({ subjectName: "Alfa s.r.o.", field: "address", previous: "Bratislava", next: null }),
  });

  assert.equal(entry.summary, "Alfa s.r.o. — Adresa: „Bratislava“ → „—“");
});
