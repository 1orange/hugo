import type { ModelExtractedPayload } from "../../modules/document-payload";

/** How far the model is with one document, as the server streams it. */
export type ExtractorProgress = {
  /** Prompt tokens read so far, of `promptTotal`; absent from servers that do not say. */
  promptProcessed?: number;
  promptTotal?: number;
  /** Tokens generated so far, thinking included. */
  generatedTokens: number;
};

export type ExtractorInput = {
  driveFileId: string;
  monthKey: string;
  textLines: string[];
  /** Called as the answer streams in; the queue shows it (extraction-progress module). */
  onProgress?: (progress: ExtractorProgress) => void;
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
