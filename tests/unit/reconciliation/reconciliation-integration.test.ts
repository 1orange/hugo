import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import {
  companies,
  events,
  files,
  months,
  pairings,
  payments,
  proofs,
} from "../../../src/lib/db/schema.ts";
import { ensureProofsForMonth } from "../../../src/adapters/store/proofs.ts";
import {
  confirmPayment,
  pairPaymentWithProof,
  savePaymentNote,
  saveProofNote,
  unpairPaymentFromProof,
} from "../../../src/lib/reconciliation/service.ts";
import { buildReconciliationView } from "../../../src/lib/reconciliation/view.ts";
import { countUntickedPayments } from "../../../src/adapters/store/payments.ts";

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-reconcile-")),
    "test.db",
  );
}

function seedMonth(dbPath: string): void {
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: "company-1", name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: "month-1",
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values([
      {
        driveFileId: "invoice-a",
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "02 Prijaté faktúry",
        parentId: "slot-02",
        name: "invoice-a.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-10T00:00:00.000Z",
        firstSeenAt: "2026-01-10T00:00:00.000Z",
        lastSeenAt: "2026-01-10T00:00:00.000Z",
        deleted: false,
      },
      {
        driveFileId: "invoice-b",
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "02 Prijaté faktúry",
        parentId: "slot-02",
        name: "invoice-b.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-11T00:00:00.000Z",
        firstSeenAt: "2026-01-11T00:00:00.000Z",
        lastSeenAt: "2026-01-11T00:00:00.000Z",
        deleted: false,
      },
      {
        driveFileId: "cash-blocek",
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "04 Bločky_hotovosť",
        parentId: "slot-04",
        name: "cash.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-12T00:00:00.000Z",
        firstSeenAt: "2026-01-12T00:00:00.000Z",
        lastSeenAt: "2026-01-12T00:00:00.000Z",
        deleted: false,
      },
    ])
    .run();

  db.insert(payments)
    .values([
      {
        companyId: 1,
        monthKey: "2026_01",
        source: "bank",
        blocekFileId: null,
        amountCents: 5000,
        amountLiteral: "50.00",
        currency: "EUR",
        receiptAt: "2026-01-10T12:00:00.000Z",
        decodeStatus: "complete",
        createdAt: "2026-01-10T12:00:00.000Z",
      },
      {
        companyId: 1,
        monthKey: "2026_01",
        source: "bank",
        blocekFileId: null,
        amountCents: 2500,
        amountLiteral: "25.00",
        currency: "EUR",
        receiptAt: "2026-01-11T12:00:00.000Z",
        decodeStatus: "complete",
        createdAt: "2026-01-11T12:00:00.000Z",
      },
      {
        companyId: 1,
        monthKey: "2026_01",
        source: "cash",
        blocekFileId: "cash-blocek",
        amountCents: 1200,
        amountLiteral: "12.00",
        currency: "EUR",
        receiptAt: "2026-01-12T12:00:00.000Z",
        decodeStatus: "complete",
        createdAt: "2026-01-12T12:00:00.000Z",
      },
    ])
    .run();

  ensureProofsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");
}

test("many-to-many pairing: one payment to two proofs and one proof to two payments", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const now = "2026-01-13T10:00:00.000Z";

  assert.equal(
    pairPaymentWithProof({
      companyId: 1,
      monthKey: "2026_01",
      paymentId: 1,
      proofDriveFileId: "invoice-a",
      now,
    }).ok,
    true,
  );
  assert.equal(
    pairPaymentWithProof({
      companyId: 1,
      monthKey: "2026_01",
      paymentId: 1,
      proofDriveFileId: "invoice-b",
      now,
    }).ok,
    true,
  );
  assert.equal(
    pairPaymentWithProof({
      companyId: 1,
      monthKey: "2026_01",
      paymentId: 2,
      proofDriveFileId: "invoice-b",
      now,
    }).ok,
    true,
  );

  const view = buildReconciliationView(1, "2026_01")!;
  assert.equal(view.payments.find((payment) => payment.id === 1)?.pairedProofIds.length, 2);
  assert.equal(
    view.unpairedProofs.some((proof) => proof.driveFileId === "invoice-b"),
    false,
  );
  assert.equal(view.unpairedProofWarnings.length, 0);
});

test("unpairing keeps history and emits Unpaired", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const now = "2026-01-13T10:00:00.000Z";

  pairPaymentWithProof({
    companyId: 1,
    monthKey: "2026_01",
    paymentId: 1,
    proofDriveFileId: "invoice-a",
    now,
  });

  const db = getDb();
  const pairing = db.select().from(pairings).get()!;
  const result = unpairPaymentFromProof({
    companyId: 1,
    monthKey: "2026_01",
    pairingId: pairing.id,
    now: "2026-01-13T11:00:00.000Z",
  });
  assert.equal(result.ok, true);

  const row = db.select().from(pairings).where(eq(pairings.id, pairing.id)).get()!;
  assert.ok(row.unpairedAt);
  assert.equal(db.select().from(pairings).all().length, 1);

  const event = db
    .select()
    .from(events)
    .where(eq(events.type, "Unpaired"))
    .get();
  assert.ok(event);
});

test("cash bločky never appear as unpaired proof warnings", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const view = buildReconciliationView(1, "2026_01")!;
  assert.equal(
    view.unpairedProofWarnings.some((warning) => warning.driveFileId === "cash-blocek"),
    false,
  );
  assert.equal(
    view.unpairedPaymentWarnings.some((warning) => warning.paymentId === 3),
    false,
  );
});

test("confirming a payment only sets confirmedAt and emits Confirmed", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const now = "2026-01-13T12:00:00.000Z";

  assert.equal(countUntickedPayments(1, "2026_01"), 3);
  assert.equal(
    confirmPayment({
      companyId: 1,
      monthKey: "2026_01",
      paymentId: 3,
      confirmed: true,
      now,
    }).ok,
    true,
  );
  assert.equal(countUntickedPayments(1, "2026_01"), 2);

  const db = getDb();
  const payment = db.select().from(payments).where(eq(payments.id, 3)).get()!;
  assert.equal(payment.confirmedAt, now);

  const event = db
    .select()
    .from(events)
    .where(eq(events.type, "Confirmed"))
    .get();
  assert.ok(event);
});

test("notes persist on payments and proofs", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);

  assert.equal(
    savePaymentNote({
      companyId: 1,
      monthKey: "2026_01",
      paymentId: 1,
      note: "  waiting for supplier reply  ",
    }).ok,
    true,
  );
  assert.equal(
    saveProofNote({
      companyId: 1,
      monthKey: "2026_01",
      proofDriveFileId: "invoice-a",
      note: "proforma maybe",
    }).ok,
    true,
  );

  const view = buildReconciliationView(1, "2026_01")!;
  assert.equal(view.payments.find((payment) => payment.id === 1)?.note, "waiting for supplier reply");
  assert.equal(
    view.unpairedProofs.find((proof) => proof.driveFileId === "invoice-a")?.note,
    "proforma maybe",
  );
});

test("closed month rejects pairing and confirming", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();
  db.update(months)
    .set({ closedAt: "2026-01-31T00:00:00.000Z" })
    .where(eq(months.id, 1))
    .run();

  const pairResult = pairPaymentWithProof({
    companyId: 1,
    monthKey: "2026_01",
    paymentId: 1,
    proofDriveFileId: "invoice-a",
  });
  assert.equal(pairResult.ok, false);

  const confirmResult = confirmPayment({
    companyId: 1,
    monthKey: "2026_01",
    paymentId: 1,
    confirmed: true,
  });
  assert.equal(confirmResult.ok, false);
});

test("proof rows are created for proof-folder files only", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();
  const proofRows = db.select().from(proofs).all();
  assert.equal(proofRows.length, 2);
  assert.equal(proofRows.some((row) => row.driveFileId === "cash-blocek"), false);
});
