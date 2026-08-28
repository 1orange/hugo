import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDriveTree,
  FOLDER_MIME,
  type DriveFileRecord,
  type StoredFileState,
} from "../../../src/modules/drive-tree.ts";
import { defaultFolderTaxonomySettings } from "../../../src/modules/folder-taxonomy.ts";

const PARENT_ID = "parent-folder";
const COMPANY_ID = "company-acme";
const MONTH_01_ID = "month-2026-01";
const MONTH_05_ID = "month-2026-05";
const SLOT_01_ID = "slot-01";
const SLOT_04_TYPO_ID = "slot-04-typo";
const SWEEP_AT = "2026-08-28T10:00:00.000Z";

function folder(
  id: string,
  name: string,
  parents: string[],
): DriveFileRecord {
  return {
    id,
    name,
    parents,
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  };
}

function file(
  id: string,
  name: string,
  parents: string[],
  createdTime = "2026-01-15T00:00:00.000Z",
): DriveFileRecord {
  return {
    id,
    name,
    parents,
    createdTime,
    mimeType: "application/pdf",
  };
}

const baseFixture: DriveFileRecord[] = [
  folder(PARENT_ID, "Clients", []),
  folder(COMPANY_ID, "Acme s.r.o.", [PARENT_ID]),
  folder(MONTH_01_ID, "2026_01", [COMPANY_ID]),
  folder(SLOT_01_ID, "01 Vystavené faktúry", [MONTH_01_ID]),
  file("doc-invoice", "invoice-001.pdf", [SLOT_01_ID]),
  file("doc-vat", "vat-report.pdf", [MONTH_01_ID]),
  folder(MONTH_05_ID, "2026_05", [COMPANY_ID]),
  folder(SLOT_04_TYPO_ID, "04 Bločky_hotorvosť", [MONTH_05_ID]),
  file("doc-receipt", "receipt-001.pdf", [SLOT_04_TYPO_ID]),
];

function runTree(
  files: DriveFileRecord[],
  storedFiles: StoredFileState[] = [],
) {
  return buildDriveTree({
    files,
    driveParentFolderId: PARENT_ID,
    storedFiles,
    sweepAt: SWEEP_AT,
    settings: defaultFolderTaxonomySettings(),
  });
}

test("buildDriveTree reconstructs company/month/folder tree from unordered flat list", () => {
  const shuffled = [...baseFixture].reverse();
  const { tree } = runTree(shuffled);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.driveFolderId, COMPANY_ID);
  assert.equal(tree[0]?.name, "Acme s.r.o.");
  assert.equal(tree[0]?.months.length, 2);

  const month01 = tree[0]?.months.find((month) => month.key === "2026_01");
  assert.ok(month01);
  assert.equal(month01.folderSlots.length, 1);
  assert.equal(month01.folderSlots[0]?.classification.kind, "canonical");
  assert.equal(month01.folderSlots[0]?.documents.length, 1);
  assert.equal(month01.monthRootOutputs.length, 1);
  assert.equal(month01.monthRootOutputs[0]?.name, "vat-report.pdf");

  const month05 = tree[0]?.months.find((month) => month.key === "2026_05");
  assert.ok(month05);
  assert.equal(month05.folderSlots[0]?.classification.kind, "repair-candidate");
});

test("buildDriveTree normalises NFD Drive names so slots classify as canonical", () => {
  // The real sample folders are all NFD. Left unnormalised, every canonical
  // folder looks like it needs renaming to a visually identical name.
  const nfdFixture = baseFixture.map((record) => ({
    ...record,
    name: record.name.normalize("NFD"),
  }));

  const { tree, updatedFiles } = runTree(nfdFixture);
  const month01 = tree[0]?.months.find((month) => month.key === "2026_01");
  assert.equal(month01?.folderSlots[0]?.classification.kind, "canonical");

  const stored = updatedFiles.find((f) => f.driveFileId === "doc-invoice");
  assert.equal(stored?.folderSlot, "01 Vystavené faktúry".normalize("NFC"));
});

test("buildDriveTree does not report a rename when only normalisation differs", () => {
  const { updatedFiles } = runTree(baseFixture);
  const nfdFixture = baseFixture.map((record) => ({
    ...record,
    name: record.name.normalize("NFD"),
  }));

  const { events } = runTree(nfdFixture, updatedFiles);
  assert.deepEqual(events, []);
});

test("buildDriveTree emits exactly one FileDiscovered for a new file", () => {
  const { events } = runTree(baseFixture);

  const discoveries = events.filter((event) => event.type === "FileDiscovered");
  assert.equal(discoveries.length, 3);
  assert.deepEqual(
    discoveries.map((event) => event.driveFileId).sort(),
    ["doc-invoice", "doc-receipt", "doc-vat"],
  );
});

test("buildDriveTree emits FileMovedByClient when parent changes, not a second discovery", () => {
  const stored: StoredFileState[] = [
    {
      driveFileId: "doc-receipt",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_05",
      folderSlot: "04 Bločky_hotorvosť",
      parentId: SLOT_04_TYPO_ID,
      name: "receipt-001.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
  ];

  const movedFixture = baseFixture.map((entry) =>
    entry.id === "doc-receipt"
      ? file("doc-receipt", "receipt-001.pdf", [SLOT_01_ID])
      : entry,
  );

  const { events } = runTree(movedFixture, stored);

  assert.equal(
    events.filter((event) => event.type === "FileDiscovered").length,
    2,
  );
  assert.deepEqual(events.find((event) => event.type === "FileMovedByClient"), {
    type: "FileMovedByClient",
    driveFileId: "doc-receipt",
    previousParentId: SLOT_04_TYPO_ID,
    newParentId: SLOT_01_ID,
    companyDriveFolderId: COMPANY_ID,
    monthKey: "2026_01",
    folderSlot: "01 Vystavené faktúry",
  });
});

test("buildDriveTree emits FileDeleted and retains row when file disappears", () => {
  const stored: StoredFileState[] = [
    {
      driveFileId: "doc-invoice",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_01",
      folderSlot: "01 Vystavené faktúry",
      parentId: SLOT_01_ID,
      name: "invoice-001.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
    {
      driveFileId: "doc-receipt",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_05",
      folderSlot: "04 Bločky_hotorvosť",
      parentId: SLOT_04_TYPO_ID,
      name: "receipt-001.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
    {
      driveFileId: "doc-vat",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_01",
      folderSlot: null,
      parentId: MONTH_01_ID,
      name: "vat-report.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
  ];

  const withoutVat = baseFixture.filter((entry) => entry.id !== "doc-vat");
  const { events, updatedFiles } = runTree(withoutVat, stored);

  assert.deepEqual(events, [{ type: "FileDeleted", driveFileId: "doc-vat" }]);
  const retained = updatedFiles.find((file) => file.driveFileId === "doc-vat");
  assert.ok(retained);
  assert.equal(retained.deleted, true);
  assert.equal(retained.firstSeenAt, "2026-08-27T10:00:00.000Z");
});

test("buildDriveTree is idempotent over unchanged input", () => {
  const first = runTree(baseFixture);
  const second = runTree(baseFixture, first.updatedFiles);

  assert.deepEqual(second.events, []);
});

test("buildDriveTree records firstSeenAt on discovery and never overwrites it", () => {
  const first = runTree(baseFixture);
  const invoice = first.updatedFiles.find(
    (file) => file.driveFileId === "doc-invoice",
  );
  assert.equal(invoice?.firstSeenAt, SWEEP_AT);

  const laterSweepAt = "2026-08-29T10:00:00.000Z";
  const second = buildDriveTree({
    files: baseFixture,
    driveParentFolderId: PARENT_ID,
    storedFiles: first.updatedFiles,
    sweepAt: laterSweepAt,
    settings: defaultFolderTaxonomySettings(),
  });

  const stillInvoice = second.updatedFiles.find(
    (file) => file.driveFileId === "doc-invoice",
  );
  assert.equal(stillInvoice?.firstSeenAt, SWEEP_AT);
  assert.equal(stillInvoice?.lastSeenAt, laterSweepAt);
});

test("buildDriveTree emits FileRenamedInDrive when only the name changes", () => {
  const stored: StoredFileState[] = [
    {
      driveFileId: "doc-invoice",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_01",
      folderSlot: "01 Vystavené faktúry",
      parentId: SLOT_01_ID,
      name: "invoice-001.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
    {
      driveFileId: "doc-receipt",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_05",
      folderSlot: "04 Bločky_hotorvosť",
      parentId: SLOT_04_TYPO_ID,
      name: "receipt-001.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
    {
      driveFileId: "doc-vat",
      companyDriveFolderId: COMPANY_ID,
      monthKey: "2026_01",
      folderSlot: null,
      parentId: MONTH_01_ID,
      name: "vat-report.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-15T00:00:00.000Z",
      firstSeenAt: "2026-08-27T10:00:00.000Z",
      lastSeenAt: "2026-08-27T10:00:00.000Z",
      deleted: false,
    },
  ];

  const renamedFixture = baseFixture.map((entry) =>
    entry.id === "doc-invoice"
      ? file("doc-invoice", "invoice-001-renamed.pdf", [SLOT_01_ID])
      : entry,
  );

  const { events } = runTree(renamedFixture, stored);

  assert.deepEqual(events, [
    {
      type: "FileRenamedInDrive",
      driveFileId: "doc-invoice",
      previousName: "invoice-001.pdf",
      newName: "invoice-001-renamed.pdf",
    },
  ]);
});
