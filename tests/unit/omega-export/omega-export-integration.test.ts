import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { saveDocumentFields, dismissDocument, confirmDocument } from "../../../src/lib/documents/service.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { getDocument } from "../../../src/adapters/store/documents.ts";
import { freshTestDb } from "../support/test-db.ts";

async function seedFile(db: ReturnType<typeof getDb>, input: {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  folderSlot: string;
  name: string;
}) {
  const now = "2026-05-20T10:00:00.000Z";
  await db.insert(files)
    .values({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      parentId: "month-folder",
      name: input.name,
      mimeType: "application/pdf",
      driveCreatedTime: now,
      firstSeenAt: now,
      lastSeenAt: now,
      deleted: false,
    });
  await db.insert(documents)
    .values({
      id: input.driveFileId,
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      extractionStatus: "complete",
      extractedPayloadJson: "{}",
      confirmedPayloadJson: "{}",
      createdAt: now,
    });
}

function fieldInput(
  partial: Partial<import("../../../src/modules/document-fields.ts").DocumentFieldFormInput>,
): import("../../../src/modules/document-fields.ts").DocumentFieldFormInput {
  return {
    exportSection: "",
    supplierName: "",
    ico: "",
    dic: "",
    icDph: "",
    customerName: "",
    customerIco: "",
    customerDic: "",
    customerIcDph: "",
    documentNumber: "",
    variableSymbol: "",
    issueDateRaw: "",
    taxableSupplyDateRaw: "",
    dueDateRaw: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "",
    recapBaseLiteral: "",
    recapVatLiteral: "",
    vatRecap: [] as Array<{ rateLiteral: string; baseLiteral: string; vatLiteral: string }>,
    ...partial,
  };
}

test("month export includes confirmed invoices only and keeps export numbers", async () => {
  await freshTestDb();
  const db = getDb();
  const companyId = (
    await db.insert(companies).values({ driveFolderId: "c1", name: "Acme", active: true }).returning({ id: companies.id })
  )[0]!.id;
  await db.insert(months)
    .values({
      companyId,
      monthKey: "2026_05",
      driveFolderId: "month-2026-05",
      closedAt: null,
      openedAt: "2026-05-01T00:00:00.000Z",
    });

  await seedFile(db, {
    driveFileId: "inv-confirmed",
    companyId,
    monthKey: "2026_05",
    folderSlot: "01 Vystavené faktúry",
    name: "issued.pdf",
  });
  await seedFile(db, {
    driveFileId: "inv-dismissed",
    companyId,
    monthKey: "2026_05",
    folderSlot: "01 Vystavené faktúry",
    name: "dismissed.pdf",
  });
  await seedFile(db, {
    driveFileId: "inv-held",
    companyId,
    monthKey: "2026_05",
    folderSlot: "02 Prijaté faktúry",
    name: "held.pdf",
  });

  await saveDocumentFields({
    companyId,
    monthKey: "2026_05",
    documentId: "inv-confirmed",
    fields: fieldInput({
      customerName: "Beta s.r.o.",
      customerIco: "31333532",
      customerDic: "2020311335",
      variableSymbol: "2026001",
      issueDateRaw: "10.05.2026",
      dueDateRaw: "20.05.2026",
      taxableSupplyDateRaw: "10.05.2026",
      amountLiteral: "123",
      vatRecap: [{ rateLiteral: "23", baseLiteral: "100", vatLiteral: "23" }],
    }),
  });
  await confirmDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "inv-confirmed",
    confirmed: true,
  });

  await dismissDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "inv-dismissed",
    reason: "already in Omega",
  });

  await saveDocumentFields({
    companyId,
    monthKey: "2026_05",
    documentId: "inv-held",
    fields: fieldInput({
      supplierName: "Long Vendor",
      ico: "87654321",
      variableSymbol: "123456789012345678901",
      issueDateRaw: "11.05.2026",
      dueDateRaw: "21.05.2026",
      taxableSupplyDateRaw: "11.05.2026",
      vatRecap: [{ rateLiteral: "23", baseLiteral: "10", vatLiteral: "2.3" }],
    }),
  });
  await confirmDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "inv-held",
    confirmed: true,
  });

  const register = new FakeCompanyRegister();

  const first = await buildMonthOmegaExport({
    companyId,
    monthKey: "2026_05",
    register,
    now: "2026-05-21T12:00:00.000Z",
  });
  assert.equal(first.preview.included.length, 1);
  assert.equal(first.preview.heldBack.length, 1);
  assert.match(iconv.decode(first.bytes, "win1250"), /R00\tT04/);
  assert.match(iconv.decode(first.bytes, "win1250"), /H2605-0001/);

  const exportedEvent = (await db.select().from(events).where(eq(events.type, "Exported")).limit(1))[0];
  assert.ok(exportedEvent);

  const second = await buildMonthOmegaExport({
    companyId,
    monthKey: "2026_05",
    register,
    now: "2026-05-21T13:00:00.000Z",
  });
  assert.equal((await getDocument("inv-confirmed"))!.exportNumber, "H2605-0001");
  assert.equal(second.preview.included[0]!.exportNumber, "H2605-0001");
});

test("month export places ekasa, receipt and misfiled invoice in correct sections", async () => {
  await freshTestDb();
  const db = getDb();
  const companyId = (
    await db.insert(companies).values({ driveFolderId: "c2", name: "Spring", active: true }).returning({ id: companies.id })
  )[0]!.id;
  await db.insert(months)
    .values({
      companyId,
      monthKey: "2026_05",
      driveFolderId: "month-2026-05-b",
      closedAt: null,
      openedAt: "2026-05-01T00:00:00.000Z",
    });

  const ekasaPayload = {
    kind: "ekasa",
    source: "lookup",
    currency: "EUR",
    amountCents: 1230,
    amountLiteral: "12.30",
    supplierName: "Pumpa s.r.o.",
    ico: "12345678",
    dic: "1234567890",
    receiptNumber: "9988",
    receiptTimestampRaw: "15.05.2026 12:00:00",
    vatRecap: [{ rateLiteral: "23", baseLiteral: "10", baseCents: 1000, vatLiteral: "2.3", vatCents: 230 }],
    lineItems: [],
    opdResponse: {
      receipt: {
        receiptId: "O-TEST",
        organization: { name: "Pumpa Org s.r.o." },
        totalPrice: 12.3,
        items: [{ price: 12.3, vatRate: 23 }],
      },
    },
  };

  await seedFile(db, {
    driveFileId: "ekasa-rcpt",
    companyId,
    monthKey: "2026_05",
    folderSlot: "05 Bločky_firemná karta",
    name: "ekasa.pdf",
  });
  await seedFile(db, {
    driveFileId: "typed-rcpt",
    companyId,
    monthKey: "2026_05",
    folderSlot: "04 Bločky_hotovosť",
    name: "scan.pdf",
  });
  await seedFile(db, {
    driveFileId: "bolt-inv",
    companyId,
    monthKey: "2026_05",
    folderSlot: "05 Bločky_firemná karta",
    name: "bolt.pdf",
  });

  await db.update(documents)
    .set({ extractedPayloadJson: JSON.stringify(ekasaPayload) })
    .where(eq(documents.driveFileId, "ekasa-rcpt"));
  await db.update(documents)
    .set({
      extractedPayloadJson: JSON.stringify({
        kind: "extracted",
        parties: [],
        currency: "EUR",
        vatRecap: [],
        docTypeHint: "receipt",
      }),
    })
    .where(eq(documents.driveFileId, "typed-rcpt"));
  await db.update(documents)
    .set({
      extractedPayloadJson: JSON.stringify({
        kind: "extracted",
        parties: [],
        currency: "EUR",
        vatRecap: [],
        docTypeHint: "invoice",
      }),
    })
    .where(eq(documents.driveFileId, "bolt-inv"));

  await saveDocumentFields({
    companyId,
    monthKey: "2026_05",
    documentId: "ekasa-rcpt",
    fields: fieldInput({
      supplierName: "Pumpa s.r.o.",
      ico: "12345678",
      receiptNumber: "9988",
      receiptTimestampRaw: "15.05.2026 12:00:00",
      amountLiteral: "12.30",
      vatRecap: [{ rateLiteral: "23", baseLiteral: "10", vatLiteral: "2.3" }],
    }),
  });
  await confirmDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "ekasa-rcpt",
    confirmed: true,
  });

  await saveDocumentFields({
    companyId,
    monthKey: "2026_05",
    documentId: "typed-rcpt",
    fields: fieldInput({
      supplierName: "Hotovost",
      ico: "87654321",
      receiptNumber: "RC1",
      issueDateRaw: "16.05.2026",
      amountLiteral: "50",
      vatRecap: [{ rateLiteral: "23", baseLiteral: "40.65", vatLiteral: "9.35" }],
    }),
  });
  await confirmDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "typed-rcpt",
    confirmed: true,
  });

  await saveDocumentFields({
    companyId,
    monthKey: "2026_05",
    documentId: "bolt-inv",
    fields: fieldInput({
      supplierName: "Bolt",
      ico: "31333532",
      variableSymbol: "3026032",
      issueDateRaw: "17.05.2026",
      dueDateRaw: "17.05.2026",
      taxableSupplyDateRaw: "17.05.2026",
      vatRecap: [{ rateLiteral: "23", baseLiteral: "10", vatLiteral: "2.3" }],
    }),
  });
  await confirmDocument({
    companyId,
    monthKey: "2026_05",
    documentId: "bolt-inv",
    confirmed: true,
  });

  const { bytes, preview } = await buildMonthOmegaExport({
    companyId,
    monthKey: "2026_05",
    register: new FakeCompanyRegister(),
    now: "2026-05-22T10:00:00.000Z",
    persist: false,
  });

  assert.equal(preview.included.length, 3);
  assert.equal(
    preview.included.filter((row) => row.section === "T01").length,
    1,
  );
  assert.equal(
    preview.included.filter((row) => row.section === "T00").length,
    2,
  );

  const text = iconv.decode(bytes, "win1250");
  assert.match(text, /R00\tT04\r\n/);
  assert.match(text, /R00\tT01\r\n/);
  assert.match(text, /R00\tT00\r\n/);
  assert.match(text, /Pumpa Org/);
  assert.match(text, /3026032/);

  const t01Headers = text.split("R00\tT01\r\n")[1]!.split("R00\tT00")[0]!
    .split("\r\n")
    .filter((line) => line.startsWith("R01\t"));
  assert.equal(t01Headers.length, 1);
  assert.match(t01Headers[0]!, /\t14\t/);

  const t00Section = text.split("R00\tT00\r\n")[1] ?? "";
  const t00Headers = t00Section.split("\r\n").filter((line) => line.startsWith("R01\t"));
  assert.equal(t00Headers.length, 2);
});
