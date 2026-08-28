import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FOLDER_NAMES,
  classifyFolder,
  defaultFolderTaxonomySettings,
  parseMonthFolder,
} from "../../../src/modules/folder-taxonomy.ts";

const settings = defaultFolderTaxonomySettings();

test("parseMonthFolder accepts YYYY_MM", () => {
  assert.deepEqual(parseMonthFolder("2026_01"), {
    year: 2026,
    month: 1,
    key: "2026_01",
  });
  assert.deepEqual(parseMonthFolder("2026_07"), {
    year: 2026,
    month: 7,
    key: "2026_07",
  });
});

test("parseMonthFolder rejects malformed month names", () => {
  for (const name of [
    "2026-01",
    "26_01",
    "2026_1",
    "2026_13",
    "2026_00",
    "january",
    "",
    "2026__01",
  ]) {
    assert.equal(parseMonthFolder(name), null, `expected null for ${name}`);
  }
});

test("classifyFolder accepts exact canonical names", () => {
  for (const name of CANONICAL_FOLDER_NAMES) {
    assert.deepEqual(classifyFolder(name, settings), {
      kind: "canonical",
      name,
    });
  }

  assert.deepEqual(classifyFolder("04 Bločky_hotovosť", settings), {
    kind: "canonical",
    name: "04 Bločky_hotovosť",
  });
});

test("classifyFolder flags typo as repair-candidate with correct target", () => {
  assert.deepEqual(classifyFolder("04 Bločky_hotorvosť", settings), {
    kind: "repair-candidate",
    observedName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
  });
});

test("classifyFolder repairs names that differ only by diacritics or separator", () => {
  assert.deepEqual(classifyFolder("03 Bankove vypisy", settings), {
    kind: "repair-candidate",
    observedName: "03 Bankove vypisy",
    targetName: "03 Bankové výpisy",
  });

  assert.deepEqual(classifyFolder("04 bločky hotovosť", settings), {
    kind: "repair-candidate",
    observedName: "04 bločky hotovosť",
    targetName: "04 Bločky_hotovosť",
  });
});

test("classifyFolder does not propose renaming a deliberate folder that shares a prefix", () => {
  // Renaming this into "04 Bločky_hotovosť" would destroy what the client meant.
  for (const name of ["04 Pokladňa", "06 Zmluvy", "02 Prijaté faktúry 2025"]) {
    assert.deepEqual(
      classifyFolder(name, settings),
      { kind: "unknown", name },
      `expected ${name} to stay unknown`,
    );
  }
});

test("classifyFolder refuses to guess between equally close canonical names", () => {
  const ambiguous = {
    canonicalFolderNames: ["01 Faktúry A", "01 Faktúry B"],
  };

  assert.deepEqual(classifyFolder("01 Faktúry X", ambiguous), {
    kind: "unknown",
    name: "01 Faktúry X",
  });
});

test("classifyFolder never silently maps unknown names to a canonical slot", () => {
  for (const name of [
    "mix doklady",
    "08 Extra folder",
    "04",
    "Bločky_hotovosť",
    "99 Unknown slot",
  ]) {
    assert.deepEqual(classifyFolder(name, settings), {
      kind: "unknown",
      name,
    });
  }
});
