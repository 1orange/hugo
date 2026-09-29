import type { BenchmarkFieldKey } from "./benchmark-scoring";
import type { BenchmarkLabel } from "./benchmark-label";
import type { FieldCheckState } from "./document-fields";
import type { ModelExtractedPayload } from "./document-payload";
import type { ExtractionCheckFlags } from "./extraction-checks";
import { clientPartyIndex, type ClientIdentity } from "./party-roles";

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
  client?: ClientIdentity | null,
): Partial<Record<BenchmarkFieldKey, FieldCheckState>> {
  const partyIndex = counterpartyPartyIndex(payload.parties, label, companyIco);
  const partyFlags = flags.parties[partyIndex];
  // Production finds her company among the parties and flags the roles
  // unless exactly one party is it (clientPartyIndex); the benchmark must not
  // pick one silently.
  const ownIco = normalizeIco(companyIco);
  const identity = client ?? (ownIco.length > 0 ? { country: "SK" as const, ico: ownIco, icDph: "" } : null);
  const rolesUndetermined = identity !== null && clientPartyIndex(payload.parties, identity) === null;
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
