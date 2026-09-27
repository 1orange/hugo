import type { Extractor, ExtractorInput, ExtractorOutput } from "./port";
import { stubPayloadForDriveFile } from "./stub-fixtures";

export function createStubExtractor(options?: { delayMs?: number }): Extractor {
  return {
    async extract(input: ExtractorInput): Promise<ExtractorOutput> {
      const delayMs = options?.delayMs ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const fixture = stubPayloadForDriveFile(input.driveFileId);
      return {
        durationMs: delayMs,
        payload: fixture ?? {
          kind: "extracted",
          source: "model",
          parties: [],
          documentNumber: null,
          variableSymbol: null,
          issueDate: null,
          taxableSupplyDate: null,
          dueDate: null,
          currency: "EUR",
          amountCents: null,
          amountLiteral: null,
          vatRecap: [],
          docTypeHint: null,
        },
      };
    },
  };
}
