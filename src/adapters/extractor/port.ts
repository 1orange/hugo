import type { ModelExtractedPayload } from "../../modules/document-payload";

export type ExtractorInput = {
  driveFileId: string;
  monthKey: string;
  textLines: string[];
};

export type ExtractorOutput = {
  payload: ModelExtractedPayload;
  durationMs: number;
  /** Tokens the model generated, thinking included — shows whether it thought. */
  completionTokens?: number;
};

export type Extractor = {
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
};
