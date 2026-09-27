import type { ConfirmedPayload, ExtractedPayload } from "./document-payload";
import {
  isEkasaPayload,
  isModelExtractedPayload,
} from "./document-payload";

export type OmegaExportSection = "T01" | "T00";

export type ExportSectionOverride = OmegaExportSection | null;

export function readExportSectionOverride(
  confirmed: ConfirmedPayload,
): ExportSectionOverride {
  const value = confirmed.exportSection;
  if (value === "T01" || value === "T00") {
    return value;
  }
  return null;
}

export function resolveExportSection(input: {
  extracted: ExtractedPayload;
  confirmed: ConfirmedPayload;
  folderSlot: string;
}): OmegaExportSection {
  const override = readExportSectionOverride(input.confirmed);
  if (override) {
    return override;
  }
  if (isEkasaPayload(input.extracted)) {
    return "T00";
  }
  if (isModelExtractedPayload(input.extracted)) {
    if (input.extracted.docTypeHint === "receipt") {
      return "T00";
    }
    if (input.extracted.docTypeHint === "invoice") {
      return "T01";
    }
  }
  if (input.folderSlot.startsWith("01 ") || input.folderSlot.startsWith("02 ")) {
    return "T01";
  }
  return "T00";
}
