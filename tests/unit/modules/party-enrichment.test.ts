import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveDicFromSlovakIcDph,
  enrichInvoiceParties,
  partySourceFromValues,
} from "../../../src/modules/party-enrichment.ts";
import { mergeDocumentFields } from "../../../src/modules/document-fields.ts";
import { emptyConfirmedPayload } from "../../../src/modules/document-payload.ts";

const profile = {
  country: "SK" as const,
  legalName: "Moja firma s.r.o.",
  ico: "31333532",
  dic: "2020311335",
  icDph: "SK7120001713",
};

function source(values: Record<string, string | null | undefined>) {
  return partySourceFromValues(values);
}

test("derives DIČ only from a valid Slovak IČ DPH", () => {
  const cases: Array<[string, string | null]> = [
    ["SK1234567890", "1234567890"],
    ["sk 1234567890", "1234567890"],
    ["SK123456789", null],
    ["SK12345678901", null],
    ["CZ12345678", null],
    ["DE123456789", null],
    ["SK12A4567890", null],
  ];
  for (const [value, expected] of cases) {
    assert.equal(deriveDicFromSlovakIcDph(value), expected, value);
  }
});

test("derives DIČ for both parties without overwriting existing values", () => {
  const result = enrichInvoiceParties({
    folderSlot: "02 Prijaté faktúry",
    supplier: source({ icDph: "SK8765432100" }),
    customer: source({ icDph: "SK7120001713", dic: "manual-dic" }),
  });
  assert.equal(result.supplier.dic.value, "8765432100");
  assert.equal(result.supplier.dic.provenance, "derived");
  assert.equal(result.customer.dic.value, "manual-dic");
  assert.equal(result.customer.dic.provenance, "extracted");
});

test("issued invoices backfill only the supplier from the profile", () => {
  const result = enrichInvoiceParties({
    folderSlot: "01 Vystavené faktúry",
    supplier: source({}),
    customer: source({ name: "Odberateľ a.s.", ico: "87654321" }),
    profile,
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.supplier).map(([key, value]) => [key, value.value])),
    {
      name: profile.legalName,
      ico: profile.ico,
      dic: profile.dic,
      icDph: profile.icDph,
    },
  );
  assert.equal(result.supplier.name.provenance, "profile");
  assert.equal(result.customer.name.value, "Odberateľ a.s.");
  assert.equal(result.customer.ico.value, "87654321");
});

test("received invoices backfill a missing customer and preserve printed values", () => {
  const result = enrichInvoiceParties({
    folderSlot: "02 Prijaté faktúry",
    supplier: source({ name: "Dodávateľ s.r.o.", icDph: "SK8765432100" }),
    customer: source({ name: "Moja firma s.r.o.", ico: "31333532" }),
    profile,
  });
  assert.equal(result.customer.name.value, profile.legalName);
  assert.equal(result.customer.ico.value, profile.ico);
  assert.equal(result.customer.dic.value, profile.dic);
  assert.equal(result.customer.icDph.value, profile.icDph);
  assert.equal(result.supplier.dic.value, "8765432100");
});

test("profile conflicts are flagged while document identity wins", () => {
  const result = enrichInvoiceParties({
    folderSlot: "02 Prijaté faktúry",
    supplier: source({ name: "Dodávateľ s.r.o.", ico: "87654321" }),
    customer: source({ name: "Printed customer", ico: "99999999", icDph: "SK9999999999" }),
    profile,
  });
  assert.equal(result.conflicts.customer, true);
  assert.equal(result.customer.name.value, "Printed customer");
  assert.equal(result.customer.ico.value, "99999999");
  assert.equal(result.customer.icDph.value, "SK9999999999");
});

test("legal-form punctuation and diacritics do not create a name conflict", () => {
  const result = enrichInvoiceParties({
    folderSlot: "02 Prijaté faktúry",
    supplier: source({ name: "Dodávateľ" }),
    customer: source({ name: "Béta s. r. o." }),
    profile: { ...profile, legalName: "Beta s.r.o." },
  });
  assert.equal(result.conflicts.customer, false);
  assert.equal(result.customer.name.value, "Béta s. r. o.");
});

test("the shared document projection exposes a profile conflict as a role warning", () => {
  const merged = mergeDocumentFields(
    {
      kind: "extracted",
      parties: [
        { name: "Supplier", ico: "87654321", dic: null, icDph: "SK8765432100" },
        { name: "Printed customer", ico: "99999999", dic: null, icDph: "SK9999999999" },
      ],
      documentNumber: "1",
      variableSymbol: "1",
      issueDate: null,
      taxableSupplyDate: null,
      dueDate: null,
      currency: "EUR",
      amountCents: null,
      amountLiteral: null,
      vatRecap: [],
      docTypeHint: "invoice",
    },
    emptyConfirmedPayload(),
    { folderSlot: "02 Prijaté faktúry", profile, extractionPipelineVersion: 5 },
  );
  assert.equal(merged.rolesFlagged, true);
  assert.equal(merged.fields.customerName, "Printed customer");
});

test("disabled enrichment leaves an older result untouched", () => {
  const result = enrichInvoiceParties({
    folderSlot: "01 Vystavené faktúry",
    supplier: source({ icDph: "SK1234567890" }),
    customer: source({}),
    profile,
    enabled: false,
  });
  assert.equal(result.supplier.dic.value, "");
  assert.equal(result.supplier.name.value, "");
  assert.equal(result.customer.name.value, "");
});

test("document field merge and export-facing projection share enriched values", () => {
  const merged = mergeDocumentFields(
    {
      kind: "extracted",
      parties: [{ name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" }],
      documentNumber: "2026-1",
      variableSymbol: "2026-1",
      issueDate: "2026-01-01",
      taxableSupplyDate: null,
      dueDate: null,
      currency: "EUR",
      amountCents: 12300,
      amountLiteral: "123.00",
      vatRecap: [],
      docTypeHint: "invoice",
    },
    emptyConfirmedPayload(),
    {
      folderSlot: "02 Prijaté faktúry",
      profile,
      extractionPipelineVersion: 5,
    },
  );
  assert.equal(merged.fields.customerName, profile.legalName);
  assert.equal(merged.fields.customerIco, profile.ico);
  assert.equal(merged.fields.customerDic, profile.dic);
  assert.equal(merged.provenance.customerName, "profile");
  assert.equal(merged.fields.dic, "8765432100");
  assert.equal(merged.provenance.dic, "derived");
});

test("an old completed result is not enriched until it is re-extracted", () => {
  const merged = mergeDocumentFields(
    {
      kind: "extracted",
      parties: [{ name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" }],
      documentNumber: null,
      variableSymbol: null,
      issueDate: null,
      taxableSupplyDate: null,
      dueDate: null,
      currency: "EUR",
      amountCents: null,
      amountLiteral: null,
      vatRecap: [],
      docTypeHint: "invoice",
    },
    emptyConfirmedPayload(),
    {
      folderSlot: "02 Prijaté faktúry",
      profile,
      extractionPipelineVersion: 4,
    },
  );
  assert.equal(merged.fields.customerName, "");
  assert.equal(merged.fields.dic, "");
});
