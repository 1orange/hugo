import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_CANONICAL_FINGERPRINT,
  LEGACY_MOVABLE_FINGERPRINT,
  folderListFingerprint,
  migratedFolderListJson,
} from "../../../src/modules/folder-defaults.ts";

// The 2026-08 defaults, which the office replaced on 2026-11-11 (ADR 0007 amendment).
const LEGACY_CANONICAL = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
  "07 Mzdy",
];

const LEGACY_MOVABLE = [
  "02 Prijaté faktúry",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
];

const CURRENT_CANONICAL = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Platby hotovosťou",
  "05 Platby kartou",
  "06 Iné doklady",
  "07 Mzdy",
];

const CURRENT_MOVABLE = [
  "02 Prijaté faktúry",
  "04 Platby hotovosťou",
  "05 Platby kartou",
  "06 Iné doklady",
];

test("the legacy fingerprints identify the 2026-08 defaults", () => {
  assert.equal(folderListFingerprint(LEGACY_CANONICAL), LEGACY_CANONICAL_FINGERPRINT);
  assert.equal(folderListFingerprint(LEGACY_MOVABLE), LEGACY_MOVABLE_FINGERPRINT);
});

test("the fingerprint does not depend on the Unicode form of the names", () => {
  const nfd = LEGACY_CANONICAL.map((name) => name.normalize("NFD"));
  assert.notEqual(nfd[1], LEGACY_CANONICAL[1], "fixture must really be NFD");
  assert.equal(folderListFingerprint(nfd), LEGACY_CANONICAL_FINGERPRINT);
});

test("the fingerprint depends on order and on every name", () => {
  const reordered = [...LEGACY_CANONICAL].reverse();
  const shortened = LEGACY_CANONICAL.slice(0, -1);
  assert.notEqual(folderListFingerprint(reordered), LEGACY_CANONICAL_FINGERPRINT);
  assert.notEqual(folderListFingerprint(shortened), LEGACY_CANONICAL_FINGERPRINT);
});

test("a stored list equal to the legacy default is replaced by the new default", () => {
  assert.equal(
    migratedFolderListJson(
      JSON.stringify(LEGACY_CANONICAL),
      LEGACY_CANONICAL_FINGERPRINT,
      CURRENT_CANONICAL,
    ),
    JSON.stringify(CURRENT_CANONICAL),
  );
});

test("a stored legacy default in NFD form is still replaced", () => {
  const nfdJson = JSON.stringify(LEGACY_MOVABLE.map((name) => name.normalize("NFD")));
  assert.equal(
    migratedFolderListJson(nfdJson, LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE),
    JSON.stringify(CURRENT_MOVABLE),
  );
});

test("a customised list is left alone, however close to the legacy default", () => {
  const withoutPayroll = JSON.stringify(LEGACY_CANONICAL.slice(0, -1));
  const reordered = JSON.stringify([...LEGACY_MOVABLE].reverse());
  const withExtra = JSON.stringify([...LEGACY_MOVABLE, "08 Pokladňa"]);

  assert.equal(migratedFolderListJson(withoutPayroll, LEGACY_CANONICAL_FINGERPRINT, CURRENT_CANONICAL), null);
  assert.equal(migratedFolderListJson(reordered, LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE), null);
  assert.equal(migratedFolderListJson(withExtra, LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE), null);
});

test("a list that is already the new default is left alone, so the rule is idempotent", () => {
  const migrated = JSON.stringify(CURRENT_CANONICAL);
  assert.equal(migratedFolderListJson(migrated, LEGACY_CANONICAL_FINGERPRINT, CURRENT_CANONICAL), null);
});

test("nothing stored, or unreadable JSON, is left alone", () => {
  assert.equal(migratedFolderListJson(null, LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE), null);
  assert.equal(migratedFolderListJson(undefined, LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE), null);
  assert.equal(migratedFolderListJson("not json", LEGACY_MOVABLE_FINGERPRINT, CURRENT_MOVABLE), null);
});
