import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeExpectedLayout,
  describeFoundLayout,
  detectCompanyLayout,
  type LayoutFolder,
} from "../../../src/modules/company-layout.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

const YEAR = 2026;
const settings = { canonicalFolderNames: CANONICAL_FOLDER_NAMES };

/** Anonymised fixtures, one per live shape on the shared drive (2026-11-23). */
const TYPE_NAMES = ["01 Vystavené faktúry", "02 Prijaté faktúry", "03 Bankové výpisy", "04 Platby hotovosťou"];

function monthFolders(upTo: number): LayoutFolder[] {
  return Array.from({ length: upTo }, (_, index) => ({
    name: `2026_${String(index + 1).padStart(2, "0")}`,
    childNames: ["01 Vystavené faktúry", "02 Prijaté faktúry"],
  }));
}

const shapes: Record<string, LayoutFolder[]> = {
  months: monthFolders(12),
  "months with older years beside": [
    { name: "2023", childNames: ["2023_01", "2023_02"] },
    { name: "2024", childNames: ["2024_01"] },
    { name: "2025", childNames: ["2025_01", "2025_02"] },
    ...monthFolders(12),
  ],
  "year-months": [{ name: "2026", childNames: monthFolders(10).map((folder) => folder.name) }],
  "year-types": [{ name: "2026", childNames: TYPE_NAMES }],
  types: TYPE_NAMES.map((name) => ({ name, childNames: [] })),
  empty: [],
};

function detect(folders: LayoutFolder[], year = YEAR) {
  return detectCompanyLayout({ folders, year, settings });
}

test("months directly in the client folder are the expected layout, older year folders beside them included", () => {
  assert.deepEqual(detect(shapes.months!), { kind: "months", year: YEAR, examples: ["2026_01", "2026_02", "2026_03"] });
  assert.equal(detect(shapes["months with older years beside"]!).kind, "months");
});

test("months inside a year folder are year-months, with example paths", () => {
  assert.deepEqual(detect(shapes["year-months"]!), {
    kind: "year-months",
    year: YEAR,
    examples: ["2026/2026_01", "2026/2026_02", "2026/2026_03"],
  });
});

test("type folders inside a year folder, with no months, are year-types", () => {
  assert.deepEqual(detect(shapes["year-types"]!), {
    kind: "year-types",
    year: YEAR,
    examples: ["2026/01 Vystavené faktúry", "2026/02 Prijaté faktúry", "2026/03 Bankové výpisy"],
  });
});

test("type folders directly in the client folder, with no year and no months, are types", () => {
  assert.deepEqual(detect(shapes.types!), {
    kind: "types",
    year: YEAR,
    examples: ["01 Vystavené faktúry", "02 Prijaté faktúry", "03 Bankové výpisy"],
  });
});

test("a client folder with no folders at all is empty, and shows no examples", () => {
  assert.deepEqual(detect(shapes.empty!), { kind: "empty", year: YEAR, examples: [] });
});

test("folders that are none of these layouts are other, and show what was found", () => {
  const folders: LayoutFolder[] = [
    { name: "Korešpondencia", childNames: [] },
    { name: "2025", childNames: [] },
  ];
  assert.deepEqual(detect(folders), { kind: "other", year: YEAR, examples: ["Korešpondencia", "2025"] });
});

test("a year folder for another year does not make a layout for this one", () => {
  const folders: LayoutFolder[] = [{ name: "2025", childNames: ["2025_01", "2025_02"] }];
  assert.equal(detect(folders).kind, "other");
});

test("a year folder with no folders inside it is other, not year-types", () => {
  assert.equal(detect([{ name: "2026", childNames: [] }]).kind, "other");
});

test("the year is the one asked for: 2027 months are not the 2026 structure", () => {
  assert.equal(detect(shapes.months!, 2027).kind, "other");
  assert.equal(detect(shapes.months!, 2027).year, 2027);
});

test("names in NFD are read as their NFC forms", () => {
  const nfd: LayoutFolder[] = TYPE_NAMES.map((name) => ({ name: name.normalize("NFD"), childNames: [] }));
  assert.equal(detect(nfd).kind, "types");
});

test("the folders a layout shows are at most three", () => {
  const many: LayoutFolder[] = Array.from({ length: 8 }, (_, index) => ({
    name: `Priečinok ${index}`,
    childNames: [],
  }));
  assert.equal(detect(many).examples.length, 3);
});

test("what is expected is the twelve months of the year directly in the client folder", () => {
  assert.equal(
    describeExpectedLayout(2026),
    "2026_01 … 2026_12 priamo v priečinku klienta a v každom mesiaci priečinky typov dokladov.",
  );
});

test("what was found names the layout in Slovak and shows the example folders", () => {
  const yearMonths = detect(shapes["year-months"]!);
  assert.match(describeFoundLayout(yearMonths), /^Mesiace sú vnorené v priečinku roka 2026 \(napríklad „2026\/2026_01“, /);

  const types = detect(shapes.types!);
  assert.match(describeFoundLayout(types), /bez roka a mesiacov/);
  assert.match(describeFoundLayout(types), /„01 Vystavené faktúry“/);

  assert.equal(describeFoundLayout(detect(shapes.empty!)), "Priečinok klienta je prázdny. Štruktúra ešte nie je nastavená.");
});
