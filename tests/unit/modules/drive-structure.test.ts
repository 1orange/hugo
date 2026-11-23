import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkCompanyStructure,
  structureBadgeLabel,
  type StructureCheckInput,
  type StructureDeviation,
  type StructureMonthInput,
} from "../../../src/modules/drive-structure.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

type SnapshotCompany = { archives: string[]; months: Record<string, string[]> };
const snapshot = JSON.parse(
  readFileSync(
    new URL("./fixtures/structure-snapshot.json", import.meta.url),
    "utf8",
  ),
) as { companies: Record<string, SnapshotCompany> };

const CURRENT = "2026_11";

/** The snapshot's Konto A as module input, with stable made-up Drive ids. */
function snapshotInput(
  companyName = "Konto A",
  currentMonthKey = CURRENT,
): StructureCheckInput {
  const company = snapshot.companies[companyName]!;
  const months: StructureMonthInput[] = Object.entries(company.months).map(
    ([key, children]) => ({
      driveFolderId: `m-${key}`,
      name: key,
      children: children.map((name, index) => ({
        driveFolderId: `f-${key}-${index}`,
        name,
      })),
    }),
  );
  return {
    company: { driveFolderId: "co-a", name: companyName },
    months,
    canonicalFolderNames: CANONICAL_FOLDER_NAMES,
    currentMonthKey,
  };
}

function withMonth(
  input: StructureCheckInput,
  monthKey: string,
  change: (children: StructureMonthInput["children"]) => StructureMonthInput["children"],
): StructureCheckInput {
  return {
    ...input,
    months: input.months.map((month) =>
      month.name === monthKey
        ? { ...month, children: change([...month.children]) }
        : month,
    ),
  };
}

function summary(deviations: StructureDeviation[]) {
  return deviations.map((deviation) => ({
    kind: deviation.kind,
    severity: deviation.severity,
    path: deviation.path,
    monthKey: deviation.monthKey,
  }));
}

test("the conforming snapshot produces zero deviations for every company", () => {
  for (const name of Object.keys(snapshot.companies)) {
    assert.deepEqual(
      checkCompanyStructure(snapshotInput(name)),
      [],
      `expected no deviations for ${name}`,
    );
  }
});

test("NFD folder names never produce deviations on their own", () => {
  const input = snapshotInput();
  const nfd = input.months.map((month) => ({
    ...month,
    children: month.children.map((child) => ({
      ...child,
      name: child.name.normalize("NFD"),
    })),
  }));
  assert.ok(
    nfd.some((month) =>
      month.children.some((child) => child.name !== child.name.normalize("NFC")),
    ),
    "the fixture must actually carry NFD names",
  );
  assert.deepEqual(checkCompanyStructure({ ...input, months: nfd }), []);
});

test("canonical names given in NFD in the settings still match NFC folders", () => {
  const input = {
    ...snapshotInput(),
    canonicalFolderNames: CANONICAL_FOLDER_NAMES.map((name) => name.normalize("NFD")),
  };
  assert.deepEqual(checkCompanyStructure(input), []);
});

type MutationCase = {
  name: string;
  change: (children: StructureMonthInput["children"]) => StructureMonthInput["children"];
  expected: Array<{
    kind: StructureDeviation["kind"];
    severity: StructureDeviation["severity"];
    path: string;
    monthKey: string;
  }>;
  /** Extra per-deviation expectations for the fields that differ by kind. */
  details?: (deviation: StructureDeviation) => void;
};

const MONTH = "2026_03";

const mutationCases: MutationCase[] = [
  {
    name: "a type with every folder of it removed from a month is subfolder-missing",
    // Both receipt folders of an older month are the one type, 04 Bločky.
    change: (children) =>
      children.filter((child) => !["04 Platby hotovosťou", "05 Platby kartou"].includes(child.name.normalize("NFC"))),
    expected: [
      {
        kind: "subfolder-missing",
        severity: "blocking",
        path: `Konto A/${MONTH}/04 Bločky`,
        monthKey: MONTH,
      },
    ],
    details: (deviation) => {
      assert.equal(deviation.folderId, null);
      assert.equal(deviation.expectedName, "04 Bločky");
      assert.equal(deviation.repair, null);
    },
  },
  {
    name: "a near-miss misspelling is subfolder-repair with the canonical target",
    change: (children) =>
      children.map((child) =>
        child.name.normalize("NFC") === "05 Platby kartou" ? { ...child, name: "05 Platby kartu" } : child,
      ),
    expected: [
      {
        kind: "subfolder-repair",
        severity: "attention",
        path: `Konto A/${MONTH}/05 Platby kartu`,
        monthKey: MONTH,
      },
    ],
    details: (deviation) => {
      assert.equal(deviation.folderId, "f-2026_03-4");
      assert.equal(deviation.observedName, "05 Platby kartu");
      assert.deepEqual(deviation.repair, { targetName: "04 Bločky" });
    },
  },
  {
    name: "a folder the client created with a type's number fills that type, and no rename is proposed",
    change: (children) =>
      children.map((child) =>
        child.name.normalize("NFC") === "04 Platby hotovosťou" ? { ...child, name: "04 Pokladňa" } : child,
      ),
    // From the number: `04 Pokladňa` is the receipts type, so the slot is filled and nothing is missing.
    expected: [],
  },
  {
    name: "an extra subfolder added to a month is folder-unrecognised",
    change: (children) => [...children, { driveFolderId: "f-extra", name: "Poznámky" }],
    expected: [
      {
        kind: "folder-unrecognised",
        severity: "attention",
        path: `Konto A/${MONTH}/Poznámky`,
        monthKey: MONTH,
      },
    ],
    details: (deviation) => {
      assert.equal(deviation.folderId, "f-extra");
      assert.equal(deviation.observedName, "Poznámky");
      assert.equal(deviation.repair, null);
    },
  },
  {
    name: "a misspelling in the NFD form the sweep sees is still one subfolder-repair",
    change: (children) =>
      children.map((child) =>
        child.name.normalize("NFC") === "07 Mzdy" ? { ...child, name: "07 Mzdi".normalize("NFD") } : child,
      ),
    expected: [
      {
        kind: "subfolder-repair",
        severity: "attention",
        path: `Konto A/${MONTH}/07 Mzdi`,
        monthKey: MONTH,
      },
    ],
  },
];

for (const testCase of mutationCases) {
  test(`mutation: ${testCase.name}`, () => {
    const input = withMonth(snapshotInput(), MONTH, testCase.change);
    const deviations = checkCompanyStructure(input);
    assert.deepEqual(summary(deviations), testCase.expected);
    testCase.details?.(deviations[0]!);
  });
}

test("the repair target is only proposed for an unambiguous near-miss", () => {
  // Two canonical names at the same distance from the observed name: a tie
  // proposes nothing, because guessing would rename the folder into the wrong slot.
  const input: StructureCheckInput = {
    company: { driveFolderId: "co-tie", name: "Konto Tie" },
    months: [
      {
        driveFolderId: "m-tie",
        name: MONTH,
        children: [{ driveFolderId: "f-tie", name: "Alfc" }],
      },
    ],
    canonicalFolderNames: ["Alfa", "Alfb"],
    currentMonthKey: CURRENT,
  };
  // Neither canonical slot is filled by a repair, so both are missing as well.
  assert.deepEqual(summary(checkCompanyStructure(input)), [
    { kind: "subfolder-missing", severity: "blocking", path: `Konto Tie/${MONTH}/Alfa`, monthKey: MONTH },
    { kind: "subfolder-missing", severity: "blocking", path: `Konto Tie/${MONTH}/Alfb`, monthKey: MONTH },
    {
      kind: "folder-unrecognised",
      severity: "attention",
      path: `Konto Tie/${MONTH}/Alfc`,
      monthKey: MONTH,
    },
  ]);
});

test("current-year months are all checked, including months still in the future", () => {
  const input = withMonth(snapshotInput(), "2026_12", (children) =>
    children.filter((child) => child.name.normalize("NFC") !== "07 Mzdy"),
  );
  assert.deepEqual(summary(checkCompanyStructure(input)), [
    {
      kind: "subfolder-missing",
      severity: "blocking",
      path: "Konto A/2026_12/07 Mzdy",
      monthKey: "2026_12",
    },
  ]);
});

test("current-year months before the current month are checked too", () => {
  const input = withMonth(snapshotInput(), "2026_01", (children) =>
    children.filter((child) => child.name.normalize("NFC") !== "01 Vystavené faktúry"),
  );
  assert.deepEqual(
    checkCompanyStructure(input).map((deviation) => deviation.monthKey),
    ["2026_01"],
  );
});

test("past-year and next-year month folders are ignored in this slice", () => {
  let input = withMonth(snapshotInput(), "2026_03", (children) => children.slice(1));
  input = {
    ...input,
    months: [
      ...input.months,
      { driveFolderId: "m-2025_12", name: "2025_12", children: [] },
      {
        driveFolderId: "m-2025_06",
        name: "2025_06",
        children: [{ driveFolderId: "x", name: "random" }],
      },
      { driveFolderId: "m-2027_01", name: "2027_01", children: [] },
    ],
  };
  const deviations = checkCompanyStructure(input);
  assert.deepEqual(
    deviations.map((deviation) => deviation.monthKey),
    ["2026_03"],
    "only the current-year mutation is reported",
  );
});

test("the year is read from the current month key, so a new year is checked from January", () => {
  const input = snapshotInput("Konto A", "2027_01");
  const deviations = checkCompanyStructure(input);
  // The 2027 month folders do not exist yet in the snapshot: nothing to check.
  assert.deepEqual(deviations, []);
  assert.deepEqual(
    checkCompanyStructure({
      ...input,
      months: [
        ...input.months,
        { driveFolderId: "m-2027_01", name: "2027_01 január", children: [] },
      ],
    }).map((deviation) => deviation.kind),
    Array(8).fill("subfolder-missing"),
    "a month from 2027_01 is expected to hold all eight types",
  );
});

test("structureBadgeLabel uses the Slovak plural forms", () => {
  assert.equal(structureBadgeLabel(1), "Štruktúra: 1 odchýlka");
  assert.equal(structureBadgeLabel(2), "Štruktúra: 2 odchýlky");
  assert.equal(structureBadgeLabel(4), "Štruktúra: 4 odchýlky");
  assert.equal(structureBadgeLabel(5), "Štruktúra: 5 odchýlok");
  assert.equal(structureBadgeLabel(0), "Štruktúra: 0 odchýlok");
});

test("a month in the older scheme is as complete as one in the current scheme", () => {
  const input = withMonth(snapshotInput("Konto A"), MONTH, (children) =>
    [
      "01 Vystavené faktúry",
      "02 Prijaté faktúry",
      "03 Bankové výpisy",
      "04 Bločky",
      "05 Iné doklady",
      "06 Mzdy",
      "07 DPH",
    ].map((name, index) => ({ driveFolderId: `old-${index}`, name })),
  );
  // (04 Bločky is the current name; the rest are the older scheme's.)
  assert.deepEqual(
    checkCompanyStructure(input).filter((deviation) => deviation.monthKey === MONTH),
    [],
  );
});

test("the later variants of the receipt folders fill their slots too", () => {
  const input = withMonth(snapshotInput("Konto A"), MONTH, (children) =>
    children.map((child) =>
      child.name === "04 Platby hotovosťou"
        ? { ...child, name: "04 Bločky_hotovosť" }
        : child.name === "05 Platby kartou"
          ? { ...child, name: "05 Platby firemnou kartou" }
          : child,
    ),
  );
  assert.deepEqual(
    checkCompanyStructure(input).filter((deviation) => deviation.monthKey === MONTH),
    [],
  );
});

test("a month from 2027_01 is read by code: any 0X-named folder is its type", () => {
  const input: StructureCheckInput = {
    company: { driveFolderId: "co-new", name: "Doklady Alivion" },
    months: [
      {
        driveFolderId: "m-2027_01",
        name: "2027_01 január",
        children: [
          "01 Vystavené faktúry",
          "02 Prijaté faktúry",
          "03 Bankové výpisy",
          "04 Bločky",
          "05 Cestovné príkazy",
          "06 Ostatné dokumenty a zmluvy",
          "07 Mzdy",
          "08 DPH",
          "Poznámky",
        ].map((name, index) => ({ driveFolderId: `n-${index}`, name })),
      },
    ],
    canonicalFolderNames: CANONICAL_FOLDER_NAMES,
    currentMonthKey: "2027_01",
  };
  assert.deepEqual(summary(checkCompanyStructure(input)), [
    { kind: "folder-unrecognised", severity: "attention", path: "Doklady Alivion/2027_01/Poznámky", monthKey: "2027_01" },
  ]);
});
