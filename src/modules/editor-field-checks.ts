import type { FieldCheckState, ScalarFieldKey } from "./document-fields";
import type { ModelExtractedPayload } from "./document-payload";
import type { ExtractionCheckFlags } from "./extraction-checks";
import { partyRoleIndices, type ClientIdentity } from "./party-roles";

export type EditorScalarFieldChecks = Partial<
  Record<ScalarFieldKey | "vatRecap", FieldCheckState>
>;

export function editorFieldChecksFromModel(input: {
  extracted: ModelExtractedPayload;
  folderSlot: string;
  profile: ClientIdentity | null;
}): EditorScalarFieldChecks | null {
  const flags: ExtractionCheckFlags | undefined = input.extracted.fieldChecks;
  if (!flags) {
    return null;
  }

  const { supplierIndex, customerIndex } = partyRoleIndices({
    parties: input.extracted.parties,
    profile: input.profile,
    folderSlot: input.folderSlot,
  });

  const supplierFlags = flags.parties[supplierIndex];
  const customerFlags = flags.parties[customerIndex];

  return {
    supplierName: supplierFlags?.name,
    ico: supplierFlags?.ico,
    dic: supplierFlags?.dic,
    icDph: supplierFlags?.icDph,
    customerName: customerFlags?.name,
    customerIco: customerFlags?.ico,
    customerDic: customerFlags?.dic,
    customerIcDph: customerFlags?.icDph,
    documentNumber: flags.documentNumber,
    variableSymbol: flags.variableSymbol,
    issueDateRaw: flags.issueDate,
    taxableSupplyDateRaw: flags.taxableSupplyDate,
    dueDateRaw: flags.dueDate,
    currency: flags.currency,
    amountLiteral: flags.amountCents,
    vatRecap: flags.vatRecap,
  };
}
