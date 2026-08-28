import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRenameAllowed,
  checkRenameTarget,
  checkCreateFolderTarget,
  resolveCapabilities,
} from "../../../src/modules/drive-mutation.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("checkRenameAllowed permits rename when capabilities are absent", () => {
  assert.deepEqual(checkRenameAllowed({}), { allowed: true });
});

test("checkRenameAllowed refuses when Drive reports canRename false", () => {
  const result = checkRenameAllowed({
    capabilities: { canRename: false, canMoveItemWithinDrive: true },
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.match(result.message, /cannot be renamed/i);
  }
});

test("checkRenameTarget accepts only canonical names", () => {
  assert.deepEqual(
    checkRenameTarget({
      currentName: "04 Bločky_hotorvosť",
      targetName: "04 Bločky_hotovosť",
      canonicalFolderNames: CANONICAL_FOLDER_NAMES,
    }),
    { allowed: true },
  );

  for (const targetName of [
    "04 Bločky_hotovost",
    "Bločky",
    "",
    "../escape",
    "04 Bločky_hotovosť ",
  ]) {
    const result = checkRenameTarget({
      currentName: "04 Bločky_hotorvosť",
      targetName,
      canonicalFolderNames: CANONICAL_FOLDER_NAMES,
    });
    assert.equal(result.allowed, false, `expected ${targetName} to be refused`);
  }
});

test("checkRenameTarget refuses a no-op rename", () => {
  const result = checkRenameTarget({
    currentName: "07 Mzdy",
    targetName: "07 Mzdy",
    canonicalFolderNames: CANONICAL_FOLDER_NAMES,
  });
  assert.equal(result.allowed, false);
});

test("checkCreateFolderTarget accepts canonical and month folder names", () => {
  assert.deepEqual(
    checkCreateFolderTarget({
      folderName: "02 Prijaté faktúry",
      canonicalFolderNames: CANONICAL_FOLDER_NAMES,
    }),
    { allowed: true },
  );

  assert.deepEqual(
    checkCreateFolderTarget({
      folderName: "2026_04",
      canonicalFolderNames: CANONICAL_FOLDER_NAMES,
      allowMonthFolder: true,
    }),
    { allowed: true },
  );

  const result = checkCreateFolderTarget({
    folderName: "Daňové priznanie DPH.pdf",
    canonicalFolderNames: CANONICAL_FOLDER_NAMES,
  });
  assert.equal(result.allowed, false);
});
