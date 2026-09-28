import type { BenchmarkFieldKey } from "./benchmark-scoring";
import type { BenchmarkLabel } from "./benchmark-label";
import type { FieldCheckState } from "./document-fields";
import type { ModelExtractedPayload } from "./document-payload";
import type { ExtractionCheckFlags } from "./extraction-checks";

function normalizeIco(value: string | null | undefined): string {
  return (value ?? "").replace(/\s/g, "");
}

function counterpartyPartyIndex(
  parties: ModelExtractedPayload["parties"],
  label: BenchmarkLabel,
  companyIco?: string | null,
): number {
  const targetIco =
    label.side === "issued"
      ? normalizeIco(label.customer.ico)
      : normalizeIco(label.supplier.ico);
  if (targetIco.length > 0) {
    const index = parties.findIndex((party) => normalizeIco(party.ico) === targetIco);
    if (index >= 0) {
      return index;
    }
  }
  const ownIco = normalizeIco(companyIco);
  const notTheCompany = ownIco ? parties.findIndex((party) => normalizeIco(party.ico) !== ownIco) : -1;
  return notTheCompany >= 0 ? notTheCompany : 0;
}

export function benchmarkFieldCheckStates(
  flags: ExtractionCheckFlags,
  label: BenchmarkLabel,
  payload: ModelExtractedPayload,
  companyIco?: string | null,
): Partial<Record<BenchmarkFieldKey, FieldCheckState>> {
  const partyIndex = counterpartyPartyIndex(payload.parties, label, companyIco);
  const partyFlags = flags.parties[partyIndex];
  // Production derives roles from the company's own IČO and flags them unless
  // exactly one party carries it (clientPartyIndex); the benchmark must not
  // pick one silently.
  const ownIco = normalizeIco(companyIco);
  const rolesUndetermined =
    ownIco.length > 0 &&
    payload.parties.filter((party) => normalizeIco(party.ico) === ownIco).length !== 1;
  const counterpartyState = (state: FieldCheckState | undefined): FieldCheckState =>
    rolesUndetermined ? "flagged" : (state ?? "empty");

  return {
    documentNumber: flags.documentNumber,
    variableSymbol: flags.variableSymbol,
    issueDate: flags.issueDate,
    taxableSupplyDate: flags.taxableSupplyDate,
    dueDate: flags.dueDate,
    currency: flags.currency,
    amountCents: flags.amountCents,
    vatRecapBase: flags.vatRecap,
    vatRecapVat: flags.vatRecap,
    vatRecapTotal: flags.vatRecap,
    counterpartyName: counterpartyState(partyFlags?.name),
    counterpartyIco: counterpartyState(partyFlags?.ico),
    counterpartyIcDph: counterpartyState(partyFlags?.icDph),
  };
}
