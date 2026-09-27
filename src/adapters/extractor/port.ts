import type { ModelExtractedPayload } from "../../modules/document-payload";

export type ExtractorInput = {
  driveFileId: string;
  monthKey: string;
  textLines: string[];
};

export type ExtractorOutput = {
  payload: ModelExtractedPayload;
  durationMs: number;
};

export type Extractor = {
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
};
