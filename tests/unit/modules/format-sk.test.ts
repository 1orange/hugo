import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awaitingPhrase,
  countWithNoun,
  DOKLAD_FORMS,
  folderSlotPrefix,
  formatDate,
  formatDateTime,
  formatSweepAge,
  formatUploadMoment,
  monthKeyYear,
  monthLabel,
  monthShortLabel,
  parseMonthKey,
  pluralSk,
} from "../../../src/modules/format-sk.ts";

test("month keys become Slovak month names", () => {
  assert.equal(monthLabel("2026_07"), "júl 2026");
  assert.equal(monthLabel("2026_01"), "január 2026");
  assert.equal(monthLabel("2025_12"), "december 2025");
  assert.equal(monthShortLabel("2026_07"), "júl");
  assert.equal(monthKeyYear("2026_07"), 2026);
});

test("an unparseable month key renders as itself rather than throwing", () => {
  assert.equal(parseMonthKey("2026-07"), null);
  assert.equal(parseMonthKey("2026_13"), null);
  assert.equal(monthLabel("nonsense"), "nonsense");
  assert.equal(monthShortLabel("2026_13"), "2026_13");
  assert.equal(monthKeyYear("nonsense"), null);
});

test("Slovak plurals use the 1 / 2-4 / rest forms, with zero taking the last", () => {
  assert.equal(pluralSk(1, DOKLAD_FORMS), "doklad");
  assert.equal(pluralSk(2, DOKLAD_FORMS), "doklady");
  assert.equal(pluralSk(4, DOKLAD_FORMS), "doklady");
  assert.equal(pluralSk(5, DOKLAD_FORMS), "dokladov");
  assert.equal(pluralSk(0, DOKLAD_FORMS), "dokladov");
  assert.equal(pluralSk(11, DOKLAD_FORMS), "dokladov");
  assert.equal(countWithNoun(3, DOKLAD_FORMS), "3 doklady");
});

test("the awaiting phrase agrees its verb as well as its noun", () => {
  assert.equal(awaitingPhrase(0), "0 dokladov čaká");
  assert.equal(awaitingPhrase(1), "1 doklad čaká");
  assert.equal(awaitingPhrase(3), "3 doklady čakajú");
  assert.equal(awaitingPhrase(12), "12 dokladov čaká");
});

test("dates render in her timezone in Slovak order", () => {
  assert.equal(formatDate("2026-07-24T13:08:00.000Z"), "24.07.2026");
  assert.equal(formatDateTime("2026-07-24T13:08:00.000Z"), "24.07.2026 15:08");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDateTime(undefined), "—");
  assert.equal(formatDate("not a date"), "—");
});

test("upload moments name the day rather than counting seconds", () => {
  const now = new Date("2026-08-30T09:00:00.000Z");
  assert.equal(
    formatUploadMoment("2026-08-30T07:02:00.000Z", now),
    "dnes 09:02",
  );
  assert.equal(
    formatUploadMoment("2026-08-29T16:41:00.000Z", now),
    "včera 18:41",
  );
  assert.equal(formatUploadMoment("2026-08-27T10:00:00.000Z", now), "pred 3 dňami");
  assert.equal(formatUploadMoment("2026-08-29T22:30:00.000Z", now), "dnes 00:30");
  assert.equal(formatUploadMoment("2026-08-10T10:00:00.000Z", now), "10.08.2026");
  assert.equal(formatUploadMoment(null, now), "—");
});

test("sweep age degrades from minutes to hours to a full timestamp", () => {
  const now = new Date("2026-08-30T09:00:00.000Z");
  assert.equal(formatSweepAge("2026-08-30T08:56:00.000Z", now), "Drive načítaný pred 4 minútami");
  assert.equal(formatSweepAge("2026-08-30T08:59:30.000Z", now), "Drive načítaný práve teraz");
  assert.equal(formatSweepAge("2026-08-30T07:00:00.000Z", now), "Drive načítaný pred 2 hodinami");
  assert.equal(formatSweepAge("2026-08-28T07:00:00.000Z", now), "Drive načítaný 28.08.2026 09:00");
  assert.equal(formatSweepAge(null, now), "Drive ešte nebol načítaný");
});

test("folder slot prefixes drive the compact filter chips", () => {
  assert.equal(folderSlotPrefix("02 Prijaté faktúry"), "02");
  assert.equal(folderSlotPrefix("05 Bločky_firemná karta"), "05");
  assert.equal(folderSlotPrefix("Neznámy priečinok"), "Neznámy priečinok");
});
