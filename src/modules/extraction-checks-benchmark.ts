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
  return 0;
}

export function benchmarkFieldCheckStates(
  flags: ExtractionCheckFlags,
  label: BenchmarkLabel,
  payload: ModelExtractedPayload,
): Partial<Record<BenchmarkFieldKey, FieldCheckState>> {
  const partyIndex = counterpartyPartyIndex(payload.parties, label);
  const partyFlags = flags.parties[partyIndex];

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
    counterpartyName: partyFlags?.name ?? "empty",
    counterpartyIco: partyFlags?.ico ?? "empty",
    counterpartyIcDph: partyFlags?.icDph ?? "empty",
  };
}
