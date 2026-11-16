import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import type { DriveFileRecord } from "../../../src/adapters/drive/port.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { listCompanySummaries } from "../../../src/lib/sweep/views.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

function folder(id: string, name: string, parent: string | null): DriveFileRecord {
  return { id, name, parents: parent ? [parent] : [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

test("a sweep of the shared drive lists every accountant's companies, each with its group", async () => {
  await freshTestDb();
  await setDriveParentFolderId("shared");
  const drive = [
    folder("shared", "Shared drive", null),
    folder("eva", "Eva – doklady klientov", "shared"),
    folder("kat", "Katarína – doklady klientov", "shared"),
    folder("co-1", "Konto Alfa s.r.o.", "eva"),
    folder("co-2", "Konto Beta s.r.o.", "kat"),
  ];
  await runSweep(new FakeDriveClient(drive));

  const rows = await listCompanySummaries();
  assert.deepEqual(
    rows.map((row) => [row.name, row.groupName]).sort(),
    [
      ["Alfa s.r.o.", "Eva"],
      ["Beta s.r.o.", "Katarína"],
    ],
  );

  // Moved to the other accountant in Drive: the next sweep follows.
  drive[3]!.parents = ["kat"];
  await runSweep(new FakeDriveClient(drive));
  assert.deepEqual(
    (await listCompanySummaries()).map((row) => row.groupName),
    ["Katarína", "Katarína"],
  );
});
