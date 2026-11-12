import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FOLDER_NAMES,
  classifyFolder,
} from "../../../src/modules/folder-taxonomy.ts";
import {
  DEFAULT_MOVABLE_FOLDER_NAMES,
  normalizeFolderName,
  previewCanonicalListImpact,
  validateCanonicalFolderNames,
  validateMovableFolderNames,
} from "../../../src/modules/folder-settings.ts";

const existingFolders = [
  {
    companyId: 1,
    companyName: "Alpha s.r.o.",
    monthKey: "2026_01",
    folderName: "02 Prijaté faktúry",
  },
  {
    companyId: 1,
    companyName: "Alpha s.r.o.",
    monthKey: "2026_01",
    folderName: "04 Platby hotovosťou",
  },
  {
    companyId: 2,
    companyName: "Beta s.r.o.",
    monthKey: "2026_03",
    folderName: "04 Platby hotorvosťou",
  },
];

test("normalizeFolderName trims and converts to NFC", () => {
  const nfd = "04 Platby hotovosťou".normalize("NFD");
  assert.equal(normalizeFolderName(`  ${nfd}  `), "04 Platby hotovosťou");
});

test("validateCanonicalFolderNames rejects an empty list", () => {
  const result = validateCanonicalFolderNames([]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors[0]!.message, /prázdny/i);
  }
});

test("validateCanonicalFolderNames rejects blank entries with index", () => {
  const result = validateCanonicalFolderNames(["01 Vystavené faktúry", "   "]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]!.index, 1);
    assert.match(result.errors[0]!.message, /prázdna/i);
  }
});

test("validateCanonicalFolderNames rejects exact duplicates", () => {
  const result = validateCanonicalFolderNames([
    "02 Prijaté faktúry",
    "02 Prijaté faktúry",
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]!.index, 1);
    assert.match(result.errors[0]!.message, /rovnaká ako/i);
  }
});

test("validateCanonicalFolderNames rejects entries that differ only by normalisation", () => {
  const nfd = "04 Platby hotovosťou".normalize("NFD");
  const result = validateCanonicalFolderNames([
    "04 Platby hotovosťou",
    nfd,
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]!.index, 1);
    assert.match(result.errors[0]!.message, /normalizáciou/i);
  }
});

test("validateCanonicalFolderNames rejects entries that differ only by case", () => {
  const result = validateCanonicalFolderNames([
    "04 Platby hotovosťou",
    "04 platby hotovosťou",
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]!.index, 1);
    assert.match(result.errors[0]!.message, /veľkosťou písmen/i);
  }
});

test("validateCanonicalFolderNames normalises valid entries to NFC on success", () => {
  const nfd = CANONICAL_FOLDER_NAMES.map((name) => name.normalize("NFD"));
  const result = validateCanonicalFolderNames(nfd);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.normalized, [...CANONICAL_FOLDER_NAMES]);
  }
});

test("saving an NFD-entered canonical name still matches the corresponding Drive folder", () => {
  const nfdEntry = "06 Ostatné dokumenty".normalize("NFD");
  const validation = validateCanonicalFolderNames([
    ...CANONICAL_FOLDER_NAMES.filter((name) => name !== "06 Ostatné dokumenty"),
    nfdEntry,
  ]);
  assert.equal(validation.ok, true);
  if (!validation.ok) {
    return;
  }

  const settings = { canonicalFolderNames: validation.normalized };
  const driveFolderName = "06 Ostatné dokumenty".normalize("NFD");
  assert.equal(classifyFolder(driveFolderName, settings).kind, "canonical");
});

test("validateMovableFolderNames requires entries to be canonical names", () => {
  const result = validateMovableFolderNames(
    ["02 Prijaté faktúry", "99 Not canonical"],
    CANONICAL_FOLDER_NAMES,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]!.index, 1);
    assert.match(result.errors[0]!.message, /canonical/i);
  }
});

test("validateMovableFolderNames accepts the default movable set", () => {
  const result = validateMovableFolderNames(
    [...DEFAULT_MOVABLE_FOLDER_NAMES],
    CANONICAL_FOLDER_NAMES,
  );
  assert.equal(result.ok, true);
});

test("previewCanonicalListImpact counts folders that would become unrecognised", () => {
  const proposed = CANONICAL_FOLDER_NAMES.filter(
    (name) => name !== "02 Prijaté faktúry",
  );
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    proposedCanonicalNames: proposed,
    existingFolders,
  });

  assert.equal(impact.totalAffected, 1);
  assert.deepEqual(impact.removedCanonicalNames, ["02 Prijaté faktúry"]);
  assert.equal(impact.affectedFolders[0]!.folderName, "02 Prijaté faktúry");
  assert.equal(impact.affectedFolders[0]!.reason, "removal");
  assert.equal(impact.byCompany[0]!.companyName, "Alpha s.r.o.");
  assert.equal(impact.byCompany[0]!.count, 1);
});

test("previewCanonicalListImpact groups affected folders by company", () => {
  const proposed = CANONICAL_FOLDER_NAMES.filter(
    (name) => name !== "02 Prijaté faktúry" && name !== "04 Bločky",
  );
  const folders = [
    ...existingFolders,
    {
      companyId: 2,
      companyName: "Beta s.r.o.",
      monthKey: "2026_02",
      folderName: "02 Prijaté faktúry",
    },
  ];
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    proposedCanonicalNames: proposed,
    existingFolders: folders,
  });

  assert.equal(impact.totalAffected, 3);
  assert.equal(impact.byCompany.length, 2);
  const alpha = impact.byCompany.find((entry) => entry.companyId === 1);
  const beta = impact.byCompany.find((entry) => entry.companyId === 2);
  assert.equal(alpha?.count, 2);
  assert.equal(beta?.count, 1);
});

test("previewCanonicalListImpact reports no impact when only adding names", () => {
  const proposed = [...CANONICAL_FOLDER_NAMES, "08 Extra slot"];
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    proposedCanonicalNames: proposed,
    existingFolders,
  });

  assert.equal(impact.totalAffected, 0);
  assert.deepEqual(impact.addedCanonicalNames, ["08 Extra slot"]);
  assert.deepEqual(impact.newlyRecognisedFolders, []);
});

test("previewCanonicalListImpact reports folders that would become recognised", () => {
  const folders = [
    ...existingFolders,
    {
      companyId: 2,
      companyName: "Beta s.r.o.",
      monthKey: "2026_03",
      folderName: "04 Pokladňa",
    },
  ];
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    proposedCanonicalNames: [...CANONICAL_FOLDER_NAMES, "04 Pokladňa"],
    existingFolders: folders,
  });

  assert.equal(impact.totalAffected, 0);
  assert.equal(impact.newlyRecognisedFolders.length, 1);
  assert.equal(impact.newlyRecognisedFolders[0]!.folderName, "04 Pokladňa");
  assert.equal(impact.newlyRecognisedFolders[0]!.companyName, "Beta s.r.o.");
});

test("previewCanonicalListImpact matches an NFD folder name against an NFC addition", () => {
  const folders = [
    {
      companyId: 3,
      companyName: "Gamma s.r.o.",
      monthKey: "2026_04",
      folderName: "07 Pokladničné doklady".normalize("NFD"),
    },
  ];
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    proposedCanonicalNames: [
      ...CANONICAL_FOLDER_NAMES,
      "07 Pokladničné doklady",
    ],
    existingFolders: folders,
  });

  assert.equal(impact.newlyRecognisedFolders.length, 1);
});

test("previewCanonicalListImpact: folders still carrying the 2026-08 names stay recognised when the list moves to the office's names", () => {
  const legacyCanonical = [
    "01 Vystavené faktúry",
    "02 Prijaté faktúry",
    "03 Bankové výpisy",
    "04 Bločky_hotovosť",
    "05 Bločky_firemná karta",
    "06 Iné doklady",
    "07 Mzdy",
  ];
  const folders = [
    { companyId: 1, companyName: "Alpha s.r.o.", monthKey: "2026_05", folderName: "04 Bločky_hotovosť" },
    { companyId: 1, companyName: "Alpha s.r.o.", monthKey: "2026_05", folderName: "05 Bločky_firemná karta" },
    { companyId: 1, companyName: "Alpha s.r.o.", monthKey: "2026_06", folderName: "04 Platby hotovosťou" },
  ];
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: legacyCanonical,
    proposedCanonicalNames: [...CANONICAL_FOLDER_NAMES],
    existingFolders: folders,
  });

  assert.deepEqual(impact.removedCanonicalNames, ["04 Bločky_hotovosť", "05 Bločky_firemná karta", "06 Iné doklady"]);
  // The older names are accepted as the office's slots (2026-11-12): no folder loses its slot.
  assert.equal(impact.totalAffected, 0);
  assert.deepEqual(impact.affectedFolders, []);
  // The office's own name is what the change adds: the preview confirms it too.
  assert.deepEqual(
    impact.newlyRecognisedFolders.map((folder) => folder.folderName),
    ["04 Platby hotovosťou"],
  );
});

test("the new default movable list is a subset of the new canonical list", () => {
  for (const name of DEFAULT_MOVABLE_FOLDER_NAMES) {
    assert.ok(CANONICAL_FOLDER_NAMES.includes(name), name);
  }
  assert.deepEqual([...DEFAULT_MOVABLE_FOLDER_NAMES], [
    "02 Prijaté faktúry",
    "04 Bločky",
    "06 Ostatné dokumenty",
  ]);
});
