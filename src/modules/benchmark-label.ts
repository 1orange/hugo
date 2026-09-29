import type { DocTypeHint, DocumentParty, DocumentVatRecapRow } from "./document-payload";

export type BenchmarkLabel = {
  driveFileId: string;
  monthKey: string;
  side: "issued" | "received";
  folderSlot: string | null;
  kvDphSection: string | null;
  docTypeHint: DocTypeHint;
  documentNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  currency: string;
  amountCents: number | null;
  amountLiteral: string | null;
  vatRecap: DocumentVatRecapRow[];
  supplier: DocumentParty;
  customer: DocumentParty;
};

export type BenchmarkImportManifest = {
  monthKey: string;
  /** The client's own IČO — spring is 45891761 — so scoring picks counterparties as production does. */
  companyIco?: string;
  /** Her company's DIČ, IČ DPH and name: production finds it by them on a document without her IČO. */
  companyDic?: string;
  companyIcDph?: string;
  companyName?: string;
  issued: Array<{
    driveFileId: string;
    documentNumber: string;
    folderSlot?: string;
  }>;
  received: Array<{
    driveFileId: string;
    /** Omega internal number, supplier document number, or receipt id — matched against the register. */
    matchKey: string;
    folderSlot?: string;
    docTypeHint?: DocTypeHint;
  }>;
};

export function serializeBenchmarkLabel(label: BenchmarkLabel): string {
  return JSON.stringify(label, null, 2);
}

export function parseBenchmarkLabel(json: string): BenchmarkLabel | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const row = parsed as BenchmarkLabel;
    if (typeof row.driveFileId !== "string" || typeof row.monthKey !== "string") {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}
