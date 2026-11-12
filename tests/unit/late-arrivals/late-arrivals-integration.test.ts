import { after, afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import type { DriveFileRecord } from "../../../src/adapters/drive/port.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { driveMutations, events, files, lateArrivals } from "../../../src/lib/db/schema.ts";
import {
  loadLateArrivalsView,
  moveLateArrivals,
  setLateArrivalIgnored,
  undoLateArrivalMove,
} from "../../../src/lib/late-arrivals/service.ts";
import { closeCompanyMonth, reopenCompanyMonth } from "../../../src/lib/month-lifecycle/service.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

/** Pins "now": the sweep, the close and the open month all read it. */
function clockAt(instant: string): void {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(instant) });
}

afterEach(() => mock.timers.reset());
after(() => mock.timers.reset());

const PARENT = "late-parent";
const COMPANY = "late-company";

function folder(id: string, name: string, parent: string): DriveFileRecord {
  return { id, name, parents: [parent], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

function pdf(id: string, parent: string, capabilities?: DriveFileRecord["capabilities"]): DriveFileRecord {
  return {
    id,
    name: `${id}.pdf`,
    parents: [parent],
    createdTime: "2026-09-15T00:00:00.000Z",
    mimeType: "application/pdf",
    ...(capabilities ? { capabilities } : {}),
  };
}

/**
 * September and October closed, November open. September has every folder the
 * test files land in; November has `02` and `03`, not `06`.
 */
function driveLayout(): DriveFileRecord[] {
  return [
    { id: PARENT, name: "Klienti", parents: [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
    folder(COMPANY, "Konto Delta s.r.o.", PARENT),
    folder("m-09", "2026_09", COMPANY),
    folder("s-09-02", "02 Prijaté faktúry", "m-09"),
    folder("s-09-03", "03 Bankové výpisy", "m-09"),
    folder("s-09-06", "06 Iné doklady", "m-09"),
    folder("m-10", "2026_10", COMPANY),
    folder("s-10-02", "02 Prijaté faktúry", "m-10"),
    folder("m-11", "2026_11", COMPANY),
    folder("s-11-02", "02 Prijaté faktúry", "m-11"),
    folder("s-11-03", "03 Bankové výpisy", "m-11"),
    pdf("early", "s-09-02"),
  ];
}

const EXTRACTION: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [],
  documentNumber: "FA-77",
  variableSymbol: "77",
  issueDate: "2026-09-20",
  taxableSupplyDate: null,
  dueDate: null,
  currency: "EUR",
  amountCents: 4200,
  amountLiteral: "42.00",
  vatRecap: [],
  docTypeHint: "invoice",
};

/** Swept in October, September closed on 20 October. */
async function seedClosedSeptember(drive: DriveFileRecord[]): Promise<FakeDriveClient> {
  await freshTestDb();
  await setDriveParentFolderId(PARENT);
  const client = new FakeDriveClient(drive);
  clockAt("2026-10-01T08:00:00.000Z");
  await runSweep(client);
  clockAt("2026-10-20T10:00:00.000Z");
  assert.deepEqual(await closeCompanyMonth(1, "2026_09"), { ok: true });
  assert.deepEqual(await closeCompanyMonth(1, "2026_10"), { ok: true });
  return client;
}

async function fileRow(driveFileId: string) {
  const [row] = await getDb().select().from(files).where(eq(files.driveFileId, driveFileId));
  return row!;
}

async function movedEvents() {
  return (await getDb().select().from(events).where(eq(events.type, "Moved"))).map((row) => JSON.parse(row.payloadJson));
}

test("what arrives in a closed month after its close is proposed for the open month, or warned about", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);

  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-invoice", "s-09-02"), pdf("late-statement", "s-09-03"), pdf("late-other", "s-09-06"));
  await runSweep(client);

  const view = await loadLateArrivalsView(1);
  assert.equal(view.openMonthKey, "2026_11", "the open month is the current month");
  assert.deepEqual(
    view.pending.map((item) => [item.driveFileId, item.sourceMonthKey, item.assessment]),
    [
      ["late-invoice", "2026_09", { kind: "move", targetMonthKey: "2026_11", targetFolderId: "s-11-02" }],
      ["late-statement", "2026_09", { kind: "warning", reason: "not-movable-folder" }],
      ["late-other", "2026_09", { kind: "warning", reason: "missing-destination", targetMonthKey: "2026_11" }],
    ],
  );
  assert.equal(view.movableCount, 1);
  assert.match(view.pending[2]!.warning!, /nemá priečinok „06 Ostatné dokumenty“/);
  assert.equal(
    view.pending.some((item) => item.driveFileId === "early"),
    false,
    "a file there before the close is not late",
  );
});

test("a batch moves the proposals in Drive, recorded first, and the document follows with its extraction", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-invoice", "s-09-02"), pdf("late-statement", "s-09-03"));
  await runSweep(client);
  // Read while it sat in September.
  await ensureDocumentsForMonth(1, "2026_09", "2026-11-12T09:00:00.000Z");
  await writeExtractedPayload("late-invoice", EXTRACTION, "complete", null);

  clockAt("2026-11-12T09:05:00.000Z");
  const result = await moveLateArrivals({ driveClient: client, companyId: 1 });

  assert.deepEqual(result, { ok: true, moved: 1, failed: [] });
  assert.deepEqual(client.moves, [{ fileId: "late-invoice", from: "s-09-02", to: "s-11-02" }]);
  const [mutation] = await getDb().select().from(driveMutations);
  assert.equal(mutation!.kind, "move");
  assert.equal(mutation!.status, "applied");
  assert.equal(mutation!.previousParent, "s-09-02");
  assert.equal(mutation!.newParent, "s-11-02");

  const moved = await fileRow("late-invoice");
  assert.deepEqual([moved.monthKey, moved.folderSlot, moved.parentId], ["2026_11", "02 Prijaté faktúry", "s-11-02"]);
  const document = await getDocument("late-invoice");
  assert.equal(document!.monthKey, "2026_11", "the document follows its file");
  assert.equal(document!.extractionStatus, "complete", "its extraction is kept");
  assert.match(document!.extractedPayloadJson, /FA-77/);

  const view = await loadLateArrivalsView(1);
  assert.deepEqual(view.pending.map((item) => item.driveFileId), ["late-statement"], "the statement is never moved");
  assert.deepEqual(view.moved.map((item) => [item.driveFileId, item.canUndo]), [["late-invoice", true]]);
  assert.deepEqual(
    (await movedEvents()).map((payload) => [payload.fromMonthKey, payload.toMonthKey, payload.undone ?? false]),
    [["2026_09", "2026_11", false]],
  );

  // A later sweep leaves the moved file alone: it is in the open month now.
  clockAt("2026-11-12T10:00:00.000Z");
  await runSweep(client);
  assert.equal((await getDb().select().from(lateArrivals).where(eq(lateArrivals.driveFileId, "late-invoice")))[0]!.status, "moved");
});

test("a move is undone back into the closed month and the late arrival is pending again", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-invoice", "s-09-02"));
  await runSweep(client);
  await moveLateArrivals({ driveClient: client, companyId: 1 });
  const [moved] = (await loadLateArrivalsView(1)).moved;

  clockAt("2026-11-12T09:30:00.000Z");
  assert.deepEqual(await undoLateArrivalMove({ driveClient: client, companyId: 1, lateArrivalId: moved!.id }), { ok: true });

  assert.deepEqual(client.moves.at(-1), { fileId: "late-invoice", from: "s-11-02", to: "s-09-02" });
  assert.equal((await fileRow("late-invoice")).monthKey, "2026_09");
  assert.ok((await getDb().select().from(driveMutations))[0]!.undoneAt);
  const view = await loadLateArrivalsView(1);
  assert.deepEqual(view.pending.map((item) => item.driveFileId), ["late-invoice"]);
  assert.equal(view.moved.length, 0);
  assert.equal((await movedEvents()).at(-1)!.undone, true);

  // Undone once, it cannot be undone again.
  assert.equal((await undoLateArrivalMove({ driveClient: client, companyId: 1, lateArrivalId: moved!.id })).ok, false);
});

test("a move decided in the open month, or moved again in Drive since, cannot be undone", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-invoice", "s-09-02"));
  await runSweep(client);
  await moveLateArrivals({ driveClient: client, companyId: 1 });
  const [moved] = (await loadLateArrivalsView(1)).moved;

  // Someone moves it on, in Drive.
  drive.find((record) => record.id === "late-invoice")!.parents = ["s-10-02"];
  await runSweep(client);
  const blocked = await undoLateArrivalMove({ driveClient: client, companyId: 1, lateArrivalId: moved!.id });
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.message, /presunutý inam/);
  assert.equal(client.moves.length, 1, "nothing was moved back");
});

test("an ignored late arrival leaves the list, and a reopened month resolves the rest", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-invoice", "s-09-02"), pdf("late-statement", "s-09-03"));
  await runSweep(client);
  const statement = (await loadLateArrivalsView(1)).pending.find((item) => item.driveFileId === "late-statement")!;

  assert.deepEqual(await setLateArrivalIgnored({ companyId: 1, lateArrivalId: statement.id, ignored: true }), { ok: true });
  await runSweep(client);
  assert.deepEqual((await loadLateArrivalsView(1)).pending.map((item) => item.driveFileId), ["late-invoice"]);

  assert.deepEqual(await reopenCompanyMonth(1, "2026_09"), { ok: true });
  assert.deepEqual((await loadLateArrivalsView(1)).pending, [], "in an open month nothing is late");
  const statuses = await getDb().select().from(lateArrivals);
  assert.deepEqual(
    statuses.map((row) => [row.driveFileId, row.status]).sort(),
    [
      ["late-invoice", "resolved"],
      ["late-statement", "ignored"],
    ],
  );
});

test("a file a client moves into a closed month from another month is a late arrival", async () => {
  const drive = driveLayout();
  drive.push(pdf("wandering", "s-11-02"));
  const client = await seedClosedSeptember(drive);

  clockAt("2026-11-12T09:00:00.000Z");
  drive.find((record) => record.id === "wandering")!.parents = ["s-09-02"];
  await runSweep(client);

  assert.deepEqual((await loadLateArrivalsView(1)).pending.map((item) => item.driveFileId), ["wandering"]);
});

test("a file Drive will not move is a warning, and a refusal mid-batch is recorded as failed", async () => {
  const drive = driveLayout();
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(
    pdf("locked", "s-09-02", { canRename: true, canMoveItemWithinDrive: false }),
    pdf("late-invoice", "s-09-02"),
  );
  await runSweep(client);

  const view = await loadLateArrivalsView(1);
  assert.deepEqual(
    view.pending.map((item) => [item.driveFileId, item.assessment?.kind === "warning" ? item.assessment.reason : "move"]),
    [
      ["locked", "cannot-move"],
      ["late-invoice", "move"],
    ],
  );

  // Drive changes its mind after the sweep: the move is refused, recorded, and the arrival stays pending.
  drive.find((record) => record.id === "late-invoice")!.capabilities = { canRename: true, canMoveItemWithinDrive: false };
  const result = await moveLateArrivals({ driveClient: client, companyId: 1 });
  assert.equal(result.ok && result.moved, 0);
  assert.equal(result.ok && result.failed.length, 1);
  const [mutation] = await getDb().select().from(driveMutations);
  assert.equal(mutation!.status, "failed");
  assert.equal((await loadLateArrivalsView(1)).pending.length, 2);
});

test("folders under older names are their slots: a late receipt is proposed for the open month's old 04 Bločky", async () => {
  const drive: DriveFileRecord[] = [
    { id: PARENT, name: "Klienti", parents: [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
    folder(COMPANY, "Doklady Delta s.r.o.", PARENT),
    folder("m-09", "2026_09", COMPANY),
    folder("s-09-04", "04 Platby hotovosťou", "m-09"),
    folder("s-09-05", "05 Platby firemnou kartou", "m-09"),
    folder("m-10", "2026_10", COMPANY),
    folder("m-11", "2026_11", COMPANY),
    folder("s-11-04", "04 Bločky", "m-11"),
  ];
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-cash", "s-09-04"), pdf("late-card", "s-09-05"));
  await runSweep(client);

  assert.equal((await fileRow("late-card")).folderSlot, "04 Bločky", "stored as its type: cash and card are one");
  const view = await loadLateArrivalsView(1);
  assert.deepEqual(
    view.pending.map((item) => [item.driveFileId, item.assessment]),
    [
      ["late-cash", { kind: "move", targetMonthKey: "2026_11", targetFolderId: "s-11-04" }],
      ["late-card", { kind: "move", targetMonthKey: "2026_11", targetFolderId: "s-11-04" }],
    ],
  );
});

test("in an older open month a late receipt goes to the folder named like the one it came from", async () => {
  const drive: DriveFileRecord[] = [
    { id: PARENT, name: "Klienti", parents: [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
    folder(COMPANY, "Doklady Delta s.r.o.", PARENT),
    folder("m-09", "2026_09", COMPANY),
    folder("s-09-cash", "04 Platby hotovosťou", "m-09"),
    folder("s-09-card", "05 Platby kartou", "m-09"),
    folder("m-10", "2026_10", COMPANY),
    folder("m-11", "2026_11", COMPANY),
    folder("s-11-cash", "04 Platby hotovosťou", "m-11"),
    folder("s-11-card", "05 Platby kartou", "m-11"),
  ];
  const client = await seedClosedSeptember(drive);
  clockAt("2026-11-12T09:00:00.000Z");
  drive.push(pdf("late-cash", "s-09-cash"), pdf("late-card", "s-09-card"));
  await runSweep(client);

  assert.deepEqual(
    (await loadLateArrivalsView(1)).pending.map((item) => [
      item.driveFileId,
      item.assessment?.kind === "move" ? item.assessment.targetFolderId : null,
    ]),
    [
      ["late-cash", "s-11-cash"],
      ["late-card", "s-11-card"],
    ],
  );
});
