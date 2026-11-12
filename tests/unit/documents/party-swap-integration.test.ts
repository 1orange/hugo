import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import {
  companies,
  documents,
  events,
  files,
  months,
} from "../../../src/lib/db/schema.ts";
import {
  ensureDocumentsForMonth,
  getDocument,
  writeExtractedPayload,
} from "../../../src/adapters/store/documents.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import {
  confirmDocument,
  saveDocumentFields,
  swapDocumentParties,
} from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import {
  mergeDocumentFields,
  type DocumentFieldFormInput,
  type EditableDocumentFields,
} from "../../../src/modules/document-fields.ts";
import {
  parseConfirmedPayload,
  parseExtractedPayload,
  serializeExtractedPayload,
  type ModelExtractedPayload,
} from "../../../src/modules/document-payload.ts";
import {
  PARTY_SWAP_FIELDS,
  swapParties,
  type PartySwapProvenance,
  type PartySwapValues,
} from "../../../src/modules/party-swap.ts";
import { freshTestDb } from "../support/test-db.ts";

const COMPANY_DRIVE_ID = "swap-company";
const MONTH_ID = "swap-month";
const SLOT_02_ID = "swap-slot-02";
const INVOICE = "swap-invoice";
const SWAP_TIME = "2026-01-13T12:00:00.000Z";

const CLIENT_PARTY = {
  name: "Delta s.r.o.",
  ico: "31333532",
  dic: "2020311335",
  icDph: "SK2020311335",
};
const COUNTERPARTY = {
  name: "Alfa s.r.o.",
  ico: "11111111",
  dic: "1111111111",
  icDph: "SK1111111111",
};

const EXTRACTION: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  // Folder 02 is received invoices, so Delta (the client) belongs on the customer side.
  parties: [COUNTERPARTY, CLIENT_PARTY],
  documentNumber: "FA-7",
  variableSymbol: "7",
  issueDate: "2026-01-10",
  taxableSupplyDate: null,
  dueDate: null,
  currency: "EUR",
  amountCents: 12000,
  amountLiteral: "120.00",
  vatRecap: [],
  docTypeHint: "invoice",
};

async function seedInvoice(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values({
    id: 1,
    driveFolderId: COMPANY_DRIVE_ID,
    name: "Delta s.r.o.",
    active: true,
  });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: "2026_01",
    driveFolderId: MONTH_ID,
    closedAt: null,
    openedAt: "2026-01-01T00:00:00.000Z",
  });
  await db.insert(files).values({
    driveFileId: INVOICE,
    companyId: 1,
    monthKey: "2026_01",
    folderSlot: "02 Prijaté faktúry",
    parentId: SLOT_02_ID,
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: "2026-01-10T00:00:00.000Z",
    firstSeenAt: "2026-01-10T00:00:00.000Z",
    lastSeenAt: "2026-01-10T00:00:00.000Z",
    deleted: false,
  });
  await ensureDocumentsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");
  await writeExtractedPayload(INVOICE, EXTRACTION, "complete", null);
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: "Delta s.r.o.",
    address: "Bratislava",
    ico: CLIENT_PARTY.ico,
    dic: CLIENT_PARTY.dic,
    icDph: CLIENT_PARTY.icDph,
    registerSource: "fake",
    savedAt: "2026-01-12T10:00:00.000Z",
  });
}

async function invoiceView(): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(1, "2026_01");
  const item = view!.documents.find((document) => document.id === INVOICE);
  assert.ok(item, "invoice is listed");
  return item;
}

function valuesOf(fields: EditableDocumentFields): PartySwapValues {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, fields[field]]),
  ) as PartySwapValues;
}

function provenanceOf(item: DocumentListItem): PartySwapProvenance {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, item.fieldEditor.provenance[field]]),
  ) as PartySwapProvenance;
}

/** The panel's form as it would be saved: every field as the document shows it. */
function formFrom(
  fields: EditableDocumentFields,
  parties: PartySwapValues,
  overrides: Partial<DocumentFieldFormInput> = {},
): DocumentFieldFormInput {
  return {
    exportSection: "",
    ...parties,
    documentNumber: fields.documentNumber,
    variableSymbol: fields.variableSymbol,
    issueDateRaw: fields.issueDateRaw,
    taxableSupplyDateRaw: fields.taxableSupplyDateRaw,
    dueDateRaw: fields.dueDateRaw,
    receiptNumber: fields.receiptNumber,
    receiptTimestampRaw: fields.receiptTimestampRaw,
    currency: fields.currency,
    amountLiteral: fields.amountLiteral,
    recapBaseLiteral: fields.recapBaseLiteral,
    recapVatLiteral: fields.recapVatLiteral,
    vatRecap: fields.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      vatLiteral: row.vatLiteral,
    })),
    ...overrides,
  };
}

async function swapFromPanel(): Promise<{ ok: boolean; message?: string }> {
  const item = await invoiceView();
  const swapped = swapParties(valuesOf(item.fieldEditor.fields), provenanceOf(item));
  return swapDocumentParties({
    companyId: 1,
    monthKey: "2026_01",
    documentId: INVOICE,
    fields: formFrom(item.fieldEditor.fields, swapped.draft),
    partyProvenance: swapped.provenance,
    now: SWAP_TIME,
  });
}

async function partiesSwappedEvents() {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.type, "PartiesSwapped"));
}

test("a swap moves the parties and their badges, persists, and reloads", async () => {
  await seedInvoice();
  const before = await invoiceView();
  assert.equal(before.fieldEditor.fields.customerName, CLIENT_PARTY.name);
  assert.equal(before.fieldEditor.provenance.customerName, "extracted");
  assert.equal(before.fieldEditor.rolesFlagged, false);

  assert.deepStrictEqual(await swapFromPanel(), { ok: true });

  // A fresh read, as after a reload.
  const after = await invoiceView();
  assert.equal(after.fieldEditor.fields.supplierName, CLIENT_PARTY.name);
  assert.equal(after.fieldEditor.fields.ico, CLIENT_PARTY.ico);
  assert.equal(after.fieldEditor.fields.dic, CLIENT_PARTY.dic);
  assert.equal(after.fieldEditor.fields.icDph, CLIENT_PARTY.icDph);
  assert.equal(after.fieldEditor.fields.customerName, COUNTERPARTY.name);
  assert.equal(after.fieldEditor.fields.customerIcDph, COUNTERPARTY.icDph);
  assert.equal(after.fieldEditor.provenance.supplierName, "extracted");
  assert.equal(after.fieldEditor.provenance.customerName, "extracted");
  assert.equal(after.fieldEditor.provenance.customerIco, "extracted");
  assert.equal(after.fieldEditor.fields.documentNumber, "FA-7");
  assert.equal(after.fieldEditor.fields.amountLiteral, "120.00");

  // The client is now on the supplier side of a received invoice.
  assert.equal(after.fieldEditor.rolesFlagged, true);
  assert.equal(after.fieldEditor.fieldChecks, null);

  const events = await partiesSwappedEvents();
  assert.equal(events.length, 1);
  assert.deepStrictEqual(JSON.parse(events[0]!.payloadJson), {
    monthKey: "2026_01",
    driveFileId: INVOICE,
    documentId: INVOICE,
  });
  assert.equal(events[0]!.actor, "user");
  assert.equal(events[0]!.companyId, 1);
});

test("a second swap restores the original sides, values and badges", async () => {
  await seedInvoice();
  const original = await invoiceView();

  assert.deepStrictEqual(await swapFromPanel(), { ok: true });
  assert.deepStrictEqual(await swapFromPanel(), { ok: true });

  const restored = await invoiceView();
  assert.deepStrictEqual(valuesOf(restored.fieldEditor.fields), valuesOf(original.fieldEditor.fields));
  assert.deepStrictEqual(provenanceOf(restored), provenanceOf(original));
  assert.equal(restored.fieldEditor.rolesFlagged, false);
  assert.equal(await partiesSwappedEvents().then((rows) => rows.length), 2);
});

test("a swap outranks a fresh extraction of the same document", async () => {
  await seedInvoice();
  assert.deepStrictEqual(await swapFromPanel(), { ok: true });

  await writeExtractedPayload(INVOICE, EXTRACTION, "complete", null);

  const after = await invoiceView();
  assert.equal(after.fieldEditor.fields.supplierName, CLIENT_PARTY.name);
  assert.equal(after.fieldEditor.fields.customerName, COUNTERPARTY.name);
});

test("an ordinary save keeps the badges of party values she did not change", async () => {
  await seedInvoice();
  assert.deepStrictEqual(await swapFromPanel(), { ok: true });
  const swapped = await invoiceView();

  const unchangedParties = valuesOf(swapped.fieldEditor.fields);
  assert.deepStrictEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: "2026_01",
      documentId: INVOICE,
      fields: formFrom(swapped.fieldEditor.fields, unchangedParties, {
        documentNumber: "FA-8",
      }),
    }),
    { ok: true },
  );
  const afterNote = await invoiceView();
  assert.equal(afterNote.fieldEditor.fields.documentNumber, "FA-8");
  assert.equal(afterNote.fieldEditor.provenance.supplierName, "extracted");
  assert.equal(afterNote.fieldEditor.provenance.customerIco, "extracted");

  // A party value she does change is hers from then on.
  assert.deepStrictEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: "2026_01",
      documentId: INVOICE,
      fields: formFrom(afterNote.fieldEditor.fields, {
        ...unchangedParties,
        supplierName: "Delta Holding s.r.o.",
      }),
    }),
    { ok: true },
  );
  const afterEdit = await invoiceView();
  assert.equal(afterEdit.fieldEditor.provenance.supplierName, "confirmed");
  assert.equal(afterEdit.fieldEditor.provenance.customerIco, "extracted");
});

test("a decided document can still have its parties swapped, as its fields can be edited", async () => {
  await seedInvoice();
  assert.deepStrictEqual(
    await confirmDocument({
      companyId: 1,
      monthKey: "2026_01",
      documentId: INVOICE,
      confirmed: true,
      now: SWAP_TIME,
    }),
    { ok: true },
  );
  const before = await getDocument(INVOICE);

  const result = await swapFromPanel();

  assert.deepStrictEqual(result, { ok: true });
  const after = await getDocument(INVOICE);
  assert.notEqual(after!.confirmedPayloadJson, before!.confirmedPayloadJson);
  assert.equal(after!.decision, "confirmed", "the decision stands");
  assert.equal((await partiesSwappedEvents()).length, 1);
});

test("an exported document refuses the swap", async () => {
  await seedInvoice();
  await getDb()
    .update(documents)
    .set({ exportedAt: "2026-01-14T00:00:00.000Z" })
    .where(eq(documents.id, INVOICE));

  assert.equal((await swapFromPanel()).ok, false);
  assert.equal((await partiesSwappedEvents()).length, 0);
});

test("a closed month refuses the swap", async () => {
  await seedInvoice();
  await getDb()
    .update(months)
    .set({ closedAt: "2026-01-31T00:00:00.000Z" })
    .where(eq(months.id, 1));

  const result = await swapFromPanel();

  assert.equal(result.ok, false);
  assert.equal(parseConfirmedPayload((await getDocument(INVOICE))!.confirmedPayloadJson).partyProvenance, undefined);
  assert.equal((await partiesSwappedEvents()).length, 0);
});

test("a swap with a malformed provenance map is refused", async () => {
  await seedInvoice();
  const item = await invoiceView();
  const swapped = swapParties(valuesOf(item.fieldEditor.fields), provenanceOf(item));

  const result = await swapDocumentParties({
    companyId: 1,
    monthKey: "2026_01",
    documentId: INVOICE,
    fields: formFrom(item.fieldEditor.fields, swapped.draft),
    partyProvenance: { ...swapped.provenance, ico: "guessed" as never },
  });

  assert.equal(result.ok, false);
  assert.equal((await partiesSwappedEvents()).length, 0);
});

test("the persisted payload records provenance only for party fields", async () => {
  await seedInvoice();
  assert.deepStrictEqual(await swapFromPanel(), { ok: true });

  const payload = parseConfirmedPayload((await getDocument(INVOICE))!.confirmedPayloadJson);
  assert.deepStrictEqual(Object.keys(payload.partyProvenance ?? {}).sort(), [...PARTY_SWAP_FIELDS].sort());
  assert.equal(payload.partyProvenance!.supplierName, "extracted");

  const merged = mergeDocumentFields(
    parseExtractedPayload((await getDocument(INVOICE))!.extractedPayloadJson),
    payload,
    { folderSlot: "02 Prijaté faktúry", profile: null },
  );
  assert.equal(merged.fields.supplierName, CLIENT_PARTY.name);
});
