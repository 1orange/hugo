import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmEditedPartyProvenance,
  partySideSource,
  pickPartyProvenance,
  PARTY_SWAP_FIELDS,
  swapParties,
  withoutPartyChecks,
  type PartySwapProvenance,
  type PartySwapValues,
} from "../../../src/modules/party-swap.ts";
import { mergeDocumentFields } from "../../../src/modules/document-fields.ts";
import { rebaseDraft } from "../../../src/modules/draft-rebase.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { emptyConfirmedPayload } from "../../../src/modules/document-payload.ts";

const SUPPLIER_FIELDS = ["supplierName", "ico", "dic", "icDph"] as const;
const CUSTOMER_FIELDS = ["customerName", "customerIco", "customerDic", "customerIcDph"] as const;

const draft = {
  exportSection: "" as "" | "T01" | "T00",
  supplierName: "Alfa s.r.o.",
  ico: "11111111",
  dic: "1111111111",
  icDph: "SK1111111111",
  customerName: "Beta s.r.o.",
  customerIco: "22222222",
  customerDic: "2222222222",
  customerIcDph: "SK2222222222",
  documentNumber: "FA-1",
  amountLiteral: "120.00",
  vatRecap: [{ rateLiteral: "20", baseLiteral: "100.00", vatLiteral: "20.00" }],
};

const provenance: PartySwapProvenance = {
  supplierName: "extracted",
  ico: "extracted",
  dic: "derived",
  icDph: "extracted",
  customerName: "profile",
  customerIco: "profile",
  customerDic: "empty",
  customerIcDph: "confirmed",
};

test("swapParties exchanges all eight party fields with their provenance", () => {
  const swapped = swapParties(draft, provenance);

  assert.equal(swapped.draft.supplierName, "Beta s.r.o.");
  assert.equal(swapped.draft.ico, "22222222");
  assert.equal(swapped.draft.dic, "2222222222");
  assert.equal(swapped.draft.icDph, "SK2222222222");
  assert.equal(swapped.draft.customerName, "Alfa s.r.o.");
  assert.equal(swapped.draft.customerIco, "11111111");
  assert.equal(swapped.draft.customerDic, "1111111111");
  assert.equal(swapped.draft.customerIcDph, "SK1111111111");

  assert.equal(swapped.provenance.supplierName, "profile");
  assert.equal(swapped.provenance.ico, "profile");
  assert.equal(swapped.provenance.dic, "empty");
  assert.equal(swapped.provenance.icDph, "confirmed");
  assert.equal(swapped.provenance.customerName, "extracted");
  assert.equal(swapped.provenance.customerIco, "extracted");
  assert.equal(swapped.provenance.customerDic, "derived");
  assert.equal(swapped.provenance.customerIcDph, "extracted");
});

test("a swap carries the register and directory badges with their values", () => {
  const badged: PartySwapProvenance = {
    ...provenance,
    supplierName: "register",
    dic: "directory",
    customerName: "directory",
    customerDic: "register",
  };

  const swapped = swapParties(draft, badged);

  assert.equal(swapped.draft.supplierName, "Beta s.r.o.");
  assert.equal(swapped.provenance.customerName, "register", "the register's name moves to the customer side");
  assert.equal(swapped.provenance.supplierName, "directory");
  assert.equal(swapped.provenance.dic, "register");
  assert.equal(swapped.provenance.customerDic, "directory");
  assert.deepStrictEqual(swapParties(swapped.draft, swapped.provenance).provenance, badged);
});

test("swapping twice restores the original draft and provenance exactly", () => {
  const once = swapParties(draft, provenance);
  const twice = swapParties(once.draft, once.provenance);

  assert.deepStrictEqual(twice.draft, draft);
  assert.deepStrictEqual(twice.provenance, provenance);
});

test("swapParties does not mutate its inputs", () => {
  const before = structuredClone(draft);
  const beforeProvenance = structuredClone(provenance);

  swapParties(draft, provenance);

  assert.deepStrictEqual(draft, before);
  assert.deepStrictEqual(provenance, beforeProvenance);
});

test("swapParties leaves every other field and its provenance untouched", () => {
  const otherProvenance = { documentNumber: "extracted", amountLiteral: "confirmed" };
  const swapped = swapParties(
    { ...draft, ...{ documentNumber: "FA-1" } },
    { ...provenance, ...otherProvenance },
  );

  assert.equal(swapped.draft.exportSection, draft.exportSection);
  assert.equal(swapped.draft.documentNumber, draft.documentNumber);
  assert.equal(swapped.draft.amountLiteral, draft.amountLiteral);
  assert.deepStrictEqual(swapped.draft.vatRecap, draft.vatRecap);
  assert.equal(swapped.provenance.documentNumber, "extracted");
  assert.equal(swapped.provenance.amountLiteral, "confirmed");
});

test("an empty side moves over as empty and the other side fills in", () => {
  const onlySupplier: PartySwapValues = {
    ...emptyValues(),
    supplierName: "Alfa s.r.o.",
    ico: "11111111",
  };
  const onlySupplierProvenance: PartySwapProvenance = {
    ...emptyProvenance(),
    supplierName: "extracted",
    ico: "extracted",
  };

  const swapped = swapParties(onlySupplier, onlySupplierProvenance);

  assert.equal(swapped.draft.supplierName, "");
  assert.equal(swapped.draft.ico, "");
  assert.equal(swapped.draft.customerName, "Alfa s.r.o.");
  assert.equal(swapped.draft.customerIco, "11111111");
  assert.equal(swapped.provenance.supplierName, "empty");
  assert.equal(swapped.provenance.ico, "empty");
  assert.equal(swapped.provenance.customerName, "extracted");
  assert.equal(swapped.provenance.customerIco, "extracted");

  const back = swapParties(swapped.draft, swapped.provenance);
  assert.deepStrictEqual(back.draft, onlySupplier);
  assert.deepStrictEqual(back.provenance, onlySupplierProvenance);
});

test("both sides empty swap to the same empty state", () => {
  const swapped = swapParties(emptyValues(), emptyProvenance());
  assert.deepStrictEqual(swapped.draft, emptyValues());
  assert.deepStrictEqual(swapped.provenance, emptyProvenance());
});

test("the swap covers exactly the eight party fields, four per side", () => {
  assert.deepStrictEqual(
    [...PARTY_SWAP_FIELDS].sort(),
    [...SUPPLIER_FIELDS, ...CUSTOMER_FIELDS].sort(),
  );
});

test("confirmEditedPartyProvenance marks only the values she changed", () => {
  const saved = { ...draft };
  const edited = { ...draft, customerIco: "33333333" };

  const marked = confirmEditedPartyProvenance(edited, saved, provenance);

  assert.equal(marked.customerIco, "confirmed");
  assert.equal(marked.supplierName, "extracted");
  assert.equal(marked.customerName, "profile");
});

test("pickPartyProvenance keeps only the eight party entries", () => {
  const picked = pickPartyProvenance({ ...provenance, documentNumber: "extracted", amountLiteral: "confirmed" });
  assert.deepStrictEqual(picked, provenance);
});

test("partySideSource builds the supplier or customer side for role validation", () => {
  const supplier = partySideSource(draft, provenance, "supplier");
  assert.deepStrictEqual(supplier.name, { value: "Alfa s.r.o.", provenance: "extracted" });
  assert.deepStrictEqual(supplier.ico, { value: "11111111", provenance: "extracted" });
  assert.deepStrictEqual(supplier.dic, { value: "1111111111", provenance: "derived" });
  assert.deepStrictEqual(supplier.icDph, { value: "SK1111111111", provenance: "extracted" });

  const customer = partySideSource(draft, provenance, "customer");
  assert.deepStrictEqual(customer.name, { value: "Beta s.r.o.", provenance: "profile" });
  assert.deepStrictEqual(customer.dic, { value: "2222222222", provenance: "empty" });
});

test("withoutPartyChecks drops only the party flags", () => {
  const checks = { supplierName: "flagged" as const, ico: "correct" as const, amountLiteral: "flagged" as const };
  assert.deepStrictEqual(withoutPartyChecks(checks), { amountLiteral: "flagged" });
  assert.equal(withoutPartyChecks(null), null);
});

// A swap persisted as confirmed values must outrank extraction and survive a
// refreshed document, the way a manual correction does (ADR 0010).
const CLIENT_PROFILE = {
  country: "SK" as const,
  ico: "31333532",
  icDph: "SK2020372640",
  dic: "2020372640",
  legalName: "Beta s.r.o.",
};

function modelExtraction(parties: ModelExtractedPayload["parties"]): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties,
    documentNumber: "FA-7",
    variableSymbol: null,
    issueDate: "2026-04-16",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
}

const FOLDER_RECEIVED = "02 Prijaté faktúry";

test("a persisted swap outranks a fresh extraction and survives draft rebasing", () => {
  // Extraction read the parties the wrong way round: the client is the supplier.
  const firstRead = modelExtraction([
    { name: "Beta s.r.o.", ico: "31333532", dic: "2020372640", icDph: "SK2020372640" },
    { name: "Alfa s.r.o.", ico: "11111111", dic: "1111111111", icDph: null },
  ]);
  const before = mergeDocumentFields(firstRead, emptyConfirmedPayload(), {
    folderSlot: FOLDER_RECEIVED,
    profile: CLIENT_PROFILE,
  });
  assert.equal(before.fields.customerIco, "31333532");

  // She swaps; the swapped display is what gets persisted, with its provenance.
  const shown = swapParties(
    displayValues(before.fields),
    partyProvenanceOf(before.provenance),
  );
  const persisted = {
    ...emptyConfirmedPayload(),
    ...shown.draft,
    partyProvenance: shown.provenance,
  };
  const afterSwap = mergeDocumentFields(firstRead, persisted, {
    folderSlot: FOLDER_RECEIVED,
    profile: CLIENT_PROFILE,
  });
  assert.equal(afterSwap.fields.supplierName, "Beta s.r.o.");
  assert.equal(afterSwap.fields.customerIco, "11111111");

  // A fresh extraction arrives with the original reading.
  const fresh = modelExtraction([
    { name: "Beta s.r.o.", ico: "31333532", dic: "2020372640", icDph: "SK2020372640" },
    { name: "Alfa s.r.o.", ico: "11111111", dic: "1111111111", icDph: null },
  ]);
  const incoming = mergeDocumentFields(fresh, persisted, {
    folderSlot: FOLDER_RECEIVED,
    profile: CLIENT_PROFILE,
  });
  assert.equal(incoming.fields.supplierName, "Beta s.r.o.");
  assert.equal(incoming.fields.customerName, "Alfa s.r.o.");

  // The panel keeps the swapped values through the refresh.
  const rebased = rebaseDraft({
    saved: displayValues(afterSwap.fields),
    draft: displayValues(afterSwap.fields),
    incoming: displayValues(incoming.fields),
  });
  assert.equal(rebased.supplierName, "Beta s.r.o.");
  assert.equal(rebased.customerIco, "11111111");
});

test("the swapped provenance badges stay where each value came from", () => {
  const extraction = modelExtraction([
    { name: "Alfa s.r.o.", ico: "11111111", dic: "1111111111", icDph: "SK1111111111" },
    { name: "Beta s.r.o.", ico: "31333532", dic: "2020372640", icDph: "SK2020372640" },
  ]);
  const before = mergeDocumentFields(extraction, emptyConfirmedPayload(), {
    folderSlot: FOLDER_RECEIVED,
    profile: CLIENT_PROFILE,
  });
  // The client is the customer (folder 02) and was read as extracted, not backfilled from the profile.
  assert.equal(before.provenance.customerName, "extracted");

  const shown = swapParties(
    displayValues(before.fields),
    partyProvenanceOf(before.provenance),
  );
  const merged = mergeDocumentFields(extraction, {
    ...emptyConfirmedPayload(),
    ...shown.draft,
    partyProvenance: shown.provenance,
  }, { folderSlot: FOLDER_RECEIVED, profile: CLIENT_PROFILE });

  assert.equal(merged.provenance.supplierName, "extracted");
  assert.equal(merged.provenance.customerName, "extracted");
  assert.equal(merged.provenance.customerIco, "extracted");
});

test("role warnings recompute from the swapped values", () => {
  const extraction = modelExtraction([
    { name: "Beta s.r.o.", ico: "31333532", dic: "2020372640", icDph: "SK2020372640" },
    { name: "Alfa s.r.o.", ico: "11111111", dic: "1111111111", icDph: null },
  ]);
  const options = { folderSlot: FOLDER_RECEIVED, profile: CLIENT_PROFILE };
  const before = mergeDocumentFields(extraction, emptyConfirmedPayload(), options);
  assert.equal(before.rolesFlagged, false);

  const shown = swapParties(
    displayValues(before.fields),
    partyProvenanceOf(before.provenance),
  );
  const merged = mergeDocumentFields(extraction, {
    ...emptyConfirmedPayload(),
    ...shown.draft,
    partyProvenance: shown.provenance,
  }, options);
  assert.equal(merged.rolesFlagged, true, "the client now sits on the supplier side of a received invoice");

  const swappedBack = swapParties(shown.draft, shown.provenance);
  const restored = mergeDocumentFields(extraction, {
    ...emptyConfirmedPayload(),
    ...swappedBack.draft,
    partyProvenance: swappedBack.provenance,
  }, options);
  assert.equal(restored.rolesFlagged, false);
});

function partyProvenanceOf(provenance: Record<string, unknown>): PartySwapProvenance {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, provenance[field]]),
  ) as PartySwapProvenance;
}

function emptyValues(): PartySwapValues {
  return Object.fromEntries(PARTY_SWAP_FIELDS.map((field) => [field, ""])) as PartySwapValues;
}

function emptyProvenance(): PartySwapProvenance {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, "empty"]),
  ) as PartySwapProvenance;
}

function displayValues(fields: Record<string, unknown>): PartySwapValues {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, String(fields[field] ?? "")]),
  ) as PartySwapValues;
}
