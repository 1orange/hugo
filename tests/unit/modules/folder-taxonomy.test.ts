import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FOLDER_NAMES,
  classifyFolder,
  defaultFolderTaxonomySettings,
  expectedSlotsFor,
  parseMonthFolder,
  slotsFilledBy,
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

test("parseMonthFolder reads the key at the start of a month named from 2027 (2027_01 január)", () => {
  assert.deepEqual(parseMonthFolder("2027_01 január"), { year: 2027, month: 1, key: "2027_01" });
  assert.deepEqual(parseMonthFolder("2027_02 február".normalize("NFD")), { year: 2027, month: 2, key: "2027_02" });
  assert.equal(parseMonthFolder("2027_012"), null);
  assert.equal(parseMonthFolder("2027_01január"), null);
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

test("classifyFolder accepts the office's eight document types", () => {
  for (const name of CANONICAL_FOLDER_NAMES) {
    assert.deepEqual(classifyFolder(name, settings), { kind: "canonical", name });
    assert.deepEqual(classifyFolder(name, settings, "2027_03"), { kind: "canonical", name });
  }
});

test("the office's canonical default is its eight types, in code order", () => {
  assert.deepEqual([...CANONICAL_FOLDER_NAMES], [
    "01 Vystavené faktúry",
    "02 Prijaté faktúry",
    "03 Bankové výpisy",
    "04 Bločky",
    "05 Cestovné príkazy",
    "06 Ostatné dokumenty",
    "07 Mzdy",
    "08 DPH",
  ]);
});

test("from 2027_01 a folder is read by its code, whatever follows it", () => {
  assert.deepEqual(classifyFolder("04 bločky a pokladňa", settings, "2027_01"), {
    kind: "canonical",
    name: "04 Bločky",
    observedName: "04 bločky a pokladňa",
  });
  assert.deepEqual(classifyFolder("08", settings, "2027_05"), { kind: "canonical", name: "08 DPH", observedName: "08" });
  for (const name of ["Bločky", "09 Iné", "4 Bločky", "04Bločky"]) {
    assert.deepEqual(classifyFolder(name, settings, "2027_01"), { kind: "unknown", name }, name);
  }
});

test("before 2027_01 the numbers meant other things: an old 05 or 06 is mapped by its name", () => {
  // In 2027 an 05 is a travel order; in 2026 it was a card receipt or other documents.
  assert.deepEqual(slotsFilledBy(classifyFolder("05 Platby kartou", settings, "2026_10")), ["04 Bločky"]);
  assert.deepEqual(slotsFilledBy(classifyFolder("05 Platby kartou", settings, "2027_01")), ["05 Cestovné príkazy"]);
});

test("older months' names are accepted as the type they stand for, in 2025 and 2026 alike", () => {
  const cases: Array<[string, string]> = [
    ["04 Platby hotovosťou", "04 Bločky"],
    ["05 Platby kartou", "04 Bločky"],
    ["05 Platby firemnou kartou", "04 Bločky"],
    ["04 Bločky_hotovosť", "04 Bločky"],
    ["04 Bločky hotovosť", "04 Bločky"],
    ["05 Bločky_firemná karta", "04 Bločky"],
    ["Bločky", "04 Bločky"],
    ["06 Iné doklady", "06 Ostatné dokumenty"],
    ["05 Iné doklady", "06 Ostatné dokumenty"],
    ["06 Cestovné príkazy", "05 Cestovné príkazy"],
    ["08 Cestovné náhrady", "05 Cestovné príkazy"],
    ["06 Mzdy", "07 Mzdy"],
    ["07 DPH", "08 DPH"],
  ];
  for (const monthKey of ["2025_06", "2026_10"]) {
    for (const [name, slot] of cases) {
      for (const form of ["NFC", "NFD"] as const) {
        assert.deepEqual(
          classifyFolder(name.normalize(form), settings, monthKey),
          { kind: "canonical", name: slot, observedName: name },
          `${monthKey} ${form} ${name}`,
        );
      }
    }
  }
});

test("a typo of an old name keeps the old name's type, not the number's new one", () => {
  // Before 2027_01 `05` is card receipts. Read by its number, this typo would be a travel order.
  assert.deepEqual(classifyFolder("05 Platby kartu", settings, "2026_03"), {
    kind: "repair-candidate",
    observedName: "05 Platby kartu",
    targetName: "04 Bločky",
  });
});

test("in an older month only the codes that kept their meaning are read by number", () => {
  // 01, 02, 03 and 07 mean the same before and from 2027_01.
  assert.deepEqual(classifyFolder("02 Faktúry od dodávateľov", settings, "2026_10"), {
    kind: "canonical",
    name: "02 Prijaté faktúry",
    observedName: "02 Faktúry od dodávateľov",
  });
  // An old 04, 05 or 06 meant cash, card or other documents: by its number it would
  // be misfiled ("staré mesiace treba mapovať podľa názvu, nie podľa čísla").
  for (const name of ["04", "05 Iné", "06 Zmluvy"]) {
    assert.deepEqual(classifyFolder(name, settings, "2026_10"), { kind: "unknown", name }, name);
  }
  // From 2027_01 the number is the type.
  assert.deepEqual(classifyFolder("05 Iné", settings, "2027_01"), {
    kind: "canonical",
    name: "05 Cestovné príkazy",
    observedName: "05 Iné",
  });
});

test("classifyFolder treats an NFD folder name as canonical, not as a repair", () => {
  for (const canonical of CANONICAL_FOLDER_NAMES) {
    assert.deepEqual(classifyFolder(canonical.normalize("NFD"), settings), { kind: "canonical", name: canonical });
  }
});

test("classifyFolder matches when the canonical list itself is NFD", () => {
  const nfdSettings = { canonicalFolderNames: CANONICAL_FOLDER_NAMES.map((n) => n.normalize("NFD")) };
  assert.equal(classifyFolder("04 Bločky", nfdSettings).kind, "canonical");
  assert.equal(classifyFolder("04 Platby hotovosťou", nfdSettings).kind, "canonical");
});

test("a near-miss in an older month is a repair candidate for the type's current name", () => {
  assert.deepEqual(classifyFolder("03 Bankove vypisy", settings, "2026_10"), {
    kind: "repair-candidate",
    observedName: "03 Bankove vypisy",
    targetName: "03 Bankové výpisy",
  });
  assert.deepEqual(classifyFolder("04 Platby hotorvosťou", settings, "2026_10"), {
    kind: "repair-candidate",
    observedName: "04 Platby hotorvosťou",
    targetName: "04 Bločky",
  });
  assert.deepEqual(classifyFolder("05 Bločky firmná karta", settings, "2026_10"), {
    kind: "repair-candidate",
    observedName: "05 Bločky firmná karta",
    targetName: "04 Bločky",
  });
});

test("a coded folder the client named herself is read by its code, and never proposed for a rename", () => {
  const cases: Array<[string, string]> = [
    ["02 Prijaté faktúry 2025", "02 Prijaté faktúry"],
    ["07 Mzdy a odvody", "07 Mzdy"],
  ];
  for (const [name, slot] of cases) {
    assert.deepEqual(classifyFolder(name, settings, "2026_10"), { kind: "canonical", name: slot, observedName: name }, name);
  }
  // From 2027_01 any code is read so.
  assert.deepEqual(classifyFolder("04 Pokladňa", settings, "2027_03"), { kind: "canonical", name: "04 Bločky", observedName: "04 Pokladňa" });
});

test("classifyFolder refuses to guess between equally close canonical names", () => {
  const ambiguous = { canonicalFolderNames: ["01 Faktúry A", "01 Faktúry B"] };
  assert.deepEqual(classifyFolder("01 Faktúry X", ambiguous), { kind: "unknown", name: "01 Faktúry X" });
});

test("classifyFolder never silently maps unknown names in an older month", () => {
  for (const name of ["mix doklady", "09 Extra folder", "99 Unknown slot", "Poznámky"]) {
    assert.deepEqual(classifyFolder(name, settings, "2026_10"), { kind: "unknown", name }, name);
  }
});

test("an older name is not accepted once its type is no longer in the canonical list", () => {
  const withoutReceipts = { canonicalFolderNames: CANONICAL_FOLDER_NAMES.filter((name) => name !== "04 Bločky") };
  assert.equal(classifyFolder("04 Platby hotovosťou", withoutReceipts, "2026_10").kind, "unknown");
});

test("an older month is expected to hold six types; a month from 2027_01 all eight", () => {
  assert.deepEqual(expectedSlotsFor("2026_10", CANONICAL_FOLDER_NAMES), [
    "01 Vystavené faktúry",
    "02 Prijaté faktúry",
    "03 Bankové výpisy",
    "04 Bločky",
    "06 Ostatné dokumenty",
    "07 Mzdy",
  ]);
  assert.deepEqual(expectedSlotsFor("2027_01", CANONICAL_FOLDER_NAMES), [...CANONICAL_FOLDER_NAMES]);
  assert.deepEqual(slotsFilledBy(classifyFolder("05 Platby kartou", settings, "2026_10")), ["04 Bločky"]);
});
