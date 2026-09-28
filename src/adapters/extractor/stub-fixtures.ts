import type { ModelExtractedPayload } from "@/modules/document-payload";

const INTEGRATION_INVOICE_LINES = [
  "FAKTÚRA č. 2026001",
  "Dodávateľ s.r.o. IČO 87654321 IČ DPH SK8765432100",
  "Odberateľ Beta s.r.o. IČO 31333532",
  "VS 2026001",
  "Dátum vystavenia 10.01.2026",
  "Dátum dodania 10.01.2026",
  "Splatnosť 20.01.2026",
  "Celkom 100.00 EUR",
];

export const E2E_SUPPLIER_INVOICE: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [
    { name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" },
    { name: "Beta s.r.o.", ico: "31333532", dic: null, icDph: "SK7120001713" },
  ],
  documentNumber: "20260077",
  variableSymbol: "20260077",
  issueDate: "2026-01-10",
  taxableSupplyDate: "2026-01-10",
  dueDate: "2026-01-20",
  currency: "EUR",
  amountCents: 12300,
  amountLiteral: "123.00",
  vatRecap: [],
  docTypeHint: "invoice",
};

export const INTEGRATION_INVOICE_A: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [
    { name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" },
    { name: "Beta s.r.o.", ico: "31333532", dic: null, icDph: "SK7120001713" },
  ],
  documentNumber: "2026001",
  variableSymbol: "2026001",
  issueDate: "2026-01-10",
  taxableSupplyDate: "2026-01-10",
  dueDate: "2026-01-20",
  currency: "EUR",
  amountCents: 10000,
  amountLiteral: "100.00",
  vatRecap: [],
  docTypeHint: "invoice",
};

const E2E_SUPPLIER_LINES = [
  "FAKTÚRA č. 20260077",
  "Dodávateľ s.r.o. IČO 87654321 IČ DPH SK8765432100",
  "Odberateľ Beta s.r.o. IČO 31333532 IČ DPH SK7120001713",
  "VS 20260077",
  "Dátum vystavenia 10.01.2026",
  "Dátum dodania 10.01.2026",
  "Splatnosť 20.01.2026",
  "Celkom 123.00 EUR",
];

export function stubTextLinesForDriveFile(driveFileId: string): string[] | null {
  if (driveFileId === "doc-invoice-a") {
    return INTEGRATION_INVOICE_LINES;
  }
  if (driveFileId === "e2e-doc-supplier") {
    return E2E_SUPPLIER_LINES;
  }
  return null;
}

export function stubPayloadForDriveFile(
  driveFileId: string,
): ModelExtractedPayload | null {
  if (driveFileId === "e2e-doc-supplier") {
    return { ...E2E_SUPPLIER_INVOICE };
  }
  if (driveFileId === "doc-invoice-a") {
    return { ...INTEGRATION_INVOICE_A };
  }
  return null;
}
