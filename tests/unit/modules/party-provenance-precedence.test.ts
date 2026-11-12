import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeDocumentFields,
  type MergeDocumentFieldsOptions,
} from "../../../src/modules/document-fields.ts";
import type { ConfirmedPayload, ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import type { DirectoryFactsByKey } from "../../../src/modules/party-enrichment.ts";
import { PARTY_ENRICHMENT_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import { directoryKeyOf } from "../../../src/modules/subject-directory.ts";
import type { ClientIdentity } from "../../../src/modules/party-roles.ts";

/**
 * The precedence of a party value's sources (PRD 0004, ADR 0022, ADR 0010):
 *   typed or taken from the register  >  printed  >  profile / derived  >  directory
 * The directory only fills what is missing; it never replaces a value, and what
 * she emptied on purpose stays empty.
 */

// Received invoice: Alfa (the counterparty) is the supplier, Delta (her company) the customer.
const CLIENT: ClientIdentity = {
  country: "SK",
  legalName: "Delta s.r.o.",
  ico: "31333532",
  dic: "2020311337",
  icDph: "SK2020311337",
};
const ALFA = { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" };
const FOLDER = "02 Prijaté faktúry";

function invoice(supplier: Partial<ModelExtractedPayload["parties"][number]>): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [
      { ...ALFA, ...supplier },
      { name: CLIENT.legalName ?? "", ico: CLIENT.ico, dic: CLIENT.dic ?? "", icDph: CLIENT.icDph ?? "" },
    ],
    documentNumber: "FA-1",
    variableSymbol: null,
    issueDate: "2026-03-03",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
}

/** The directory's facts for the subject a party as printed resolves to (ADR 0022). */
function directoryFor(
  party: { name?: string; ico: string; dic: string; icDph: string },
  facts: { name?: string; dic?: string; icDph?: string },
): DirectoryFactsByKey {
  const key = directoryKeyOf({ name: party.name ?? "", ico: party.ico, dic: party.dic, icDph: party.icDph });
  assert.ok(key, "the party has a directory key");
  return {
    [key]: { name: facts.name ?? "Alfa s.r.o.", dic: facts.dic ?? "2020322832", icDph: facts.icDph ?? "SK2020322832" },
  };
}

function options(extra: Partial<MergeDocumentFieldsOptions> = {}): MergeDocumentFieldsOptions {
  return {
    folderSlot: FOLDER,
    profile: CLIENT,
    extractionPipelineVersion: PARTY_ENRICHMENT_PIPELINE_VERSION,
    ...extra,
  };
}

/** The supplier's name, DIČ and IČ DPH with their provenance, as the merge shows them. */
function supplierOf(
  payload: ModelExtractedPayload,
  confirmed: ConfirmedPayload,
  extra: Partial<MergeDocumentFieldsOptions> = {},
) {
  const merged = mergeDocumentFields(payload, confirmed, options(extra));
  return {
    name: [merged.fields.supplierName, merged.provenance.supplierName],
    dic: [merged.fields.dic, merged.provenance.dic],
    icDph: [merged.fields.icDph, merged.provenance.icDph],
  };
}

test("a missing DIČ and IČ DPH of a known subject are filled, and marked as the directory's", () => {
  const supplier = supplierOf(invoice({}), {}, { directory: directoryFor(ALFA, {}) });

  assert.deepEqual(supplier.dic, ["2020322832", "directory"]);
  assert.deepEqual(supplier.icDph, ["SK2020322832", "directory"]);
});

test("a party with only an IČO is filled from the one subject holding that IČO", () => {
  const supplier = supplierOf(invoice({}), {}, { directory: directoryFor(ALFA, {}) });

  assert.deepEqual(supplier.dic, ["2020322832", "directory"]);
});

test("a printed DIČ conflicting with the directory is kept, and stays extracted", () => {
  const printed = { ...ALFA, dic: "2020999999" };
  const supplier = supplierOf(invoice({ dic: "2020999999" }), {}, {
    directory: directoryFor(printed, {}),
  });

  assert.deepEqual(supplier.dic, ["2020999999", "extracted"]);
});

test("a printed name is never replaced; the directory names a party only when it has none", () => {
  const named = supplierOf(invoice({ name: "ALFA Trade" }), {}, { directory: directoryFor(ALFA, {}) });
  assert.deepEqual(named.name, ["ALFA Trade", "extracted"]);

  const unnamed = supplierOf(invoice({ name: "" }), {}, { directory: directoryFor(ALFA, {}) });
  assert.deepEqual(unnamed.name, ["Alfa s.r.o.", "directory"]);
});

test("a DIČ derived from a printed IČ DPH is derived, not taken from the directory", () => {
  const printed = { ...ALFA, icDph: "SK2020322832" };
  const supplier = supplierOf(invoice({ icDph: "SK2020322832" }), {}, {
    directory: directoryFor(printed, { dic: "2020322899" }),
  });

  assert.deepEqual(supplier.dic, ["2020322832", "derived"]);
});

test("her own DIČ comes from the profile before the directory is asked", () => {
  // Her company is the customer of a received invoice; her profile has a DIČ, the directory another.
  const payload = invoice({});
  const clientAsPrinted = { name: CLIENT.legalName ?? "", ico: CLIENT.ico, dic: "", icDph: "" };
  const withoutDic: ModelExtractedPayload = {
    ...payload,
    parties: [payload.parties[0]!, clientAsPrinted],
  };
  const filled = mergeDocumentFields(withoutDic, {}, options({ profile: CLIENT }));
  const directory = directoryFor(
    { ...clientAsPrinted, dic: CLIENT.dic ?? "" },
    { name: CLIENT.legalName, dic: "2020399999", icDph: "" },
  );
  const merged = mergeDocumentFields(withoutDic, {}, options({ profile: CLIENT, directory }));

  assert.equal(filled.fields.customerDic, "2020311337");
  assert.equal(merged.fields.customerDic, "2020311337");
  assert.equal(merged.provenance.customerDic, "profile");
});

test("a value she typed wins over the directory", () => {
  const supplier = supplierOf(invoice({}), { dic: "2020111111" }, { directory: directoryFor(ALFA, {}) });

  assert.deepEqual(supplier.dic, ["2020111111", "confirmed"]);
});

test("a DIČ she emptied on purpose stays empty, though the directory knows one", () => {
  const supplier = supplierOf(invoice({}), { dic: null }, { directory: directoryFor(ALFA, {}) });

  assert.deepEqual(supplier.dic, ["", "empty"]);
});

test("a value taken from the register is kept against a directory fill", () => {
  const confirmed: ConfirmedPayload = {
    supplierName: "Alfa s.r.o.",
    dic: "2020322832",
    partyProvenance: { supplierName: "register", dic: "register" },
  };
  const merged = mergeDocumentFields(invoice({}), confirmed, options({
    directory: directoryFor(ALFA, { dic: "2020322899" }),
  }));

  assert.equal(merged.fields.dic, "2020322832");
  assert.equal(merged.provenance.dic, "register");
  assert.equal(merged.provenance.supplierName, "register");
});

test("a re-extraction never replaces a typed value", () => {
  const confirmed: ConfirmedPayload = { dic: "2020111111" };
  const reread = invoice({ dic: "2020555555" });

  const merged = mergeDocumentFields(reread, confirmed, options({ directory: directoryFor(ALFA, {}) }));
  assert.equal(merged.fields.dic, "2020111111");
  assert.equal(merged.provenance.dic, "confirmed");
});

test("the facts of a different subject are not used", () => {
  const other = { name: "Iný s.r.o.", ico: "35757442", dic: "", icDph: "" };
  const supplier = supplierOf(invoice({}), {}, {
    directory: directoryFor(other, { name: "Iný s.r.o.", dic: "2020357574", icDph: "SK2020357574" }),
  });

  assert.deepEqual(supplier.dic, ["", "empty"]);
  assert.deepEqual(supplier.icDph, ["", "empty"]);
});

test("without directory facts the merge is what it was before", () => {
  const supplier = supplierOf(invoice({}), {});

  assert.deepEqual(supplier.dic, ["", "empty"]);
  assert.deepEqual(supplier.name, ["Alfa s.r.o.", "extracted"]);
});
