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

/**
 * How the model's time split between reading the prompt and writing the
 * answer. The server's own figures when it sends them (llama.cpp `timings`);
 * otherwise the stream's clock, where the first token marks the end of the prompt.
 */
export type ModelTiming = {
  promptMs: number;
  promptTokens?: number;
  answerMs: number;
  answerTokens?: number;
};

export type ExtractorOutput = {
  payload: ModelExtractedPayload;
  durationMs: number;
  /** Tokens the model generated, thinking included — shows whether it thought. */
  completionTokens?: number;
  timing?: ModelTiming;
};

export type Extractor = {
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
};
