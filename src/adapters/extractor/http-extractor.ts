import { parseSignedDecimalAmount } from "../../modules/money";
import { trimLinesForModel } from "../../modules/model-input";
import {
  normalizeModelAmountLiteral,
  normalizeModelCurrency,
  normalizeModelDate,
  normalizeModelDic,
  normalizeModelDocumentNumber,
  normalizeModelIcDph,
  normalizeModelIco,
  normalizeModelPartyName,
  normalizeModelVariableSymbol,
} from "../../modules/model-output-normalize";
import type { DocTypeHint, ModelExtractedPayload } from "../../modules/document-payload";
import type { Extractor, ExtractorInput, ExtractorOutput, ExtractorProgress } from "./port";
import {
  MODEL_EXTRACTED_JSON_SCHEMA,
  type ModelExtractionResponseBody,
} from "./model-extracted-schema";

export const EXTRACTOR_USER_AGENT = "hugo-accounting/0.1";

type FetchLike = typeof fetch;

export type HttpExtractorOptions = {
  baseUrl: string;
  model: string;
  thinkingEnabled?: boolean;
  /** One document's deadline; past it the document fails instead of waiting. */
  timeoutMs?: number;
  /** Tokens the model may generate; see DEFAULT_MAX_TOKENS_WITHOUT_THINKING. */
  maxTokens?: number;
  /** Drop lines that carry nothing (model-input module). On unless false; the benchmark can compare. */
  trimInput?: boolean;
  fetchImpl?: FetchLike;
};

/** Ten minutes: the adoption bar's median is one; a thinking 4B on CPU runs several. */
export const DEFAULT_EXTRACTOR_TIMEOUT_MS = 10 * 60_000;

/**
 * An answer is ~330 tokens without thinking; a model that loops runs until
 * the context is full — Qwen3 1.7B generated for ten minutes on one scan. Six
 * times a normal answer stops that in ~2.5 min on the 4B. With thinking, the
 * thinking counts too, so no cap unless one is set.
 */
export const DEFAULT_MAX_TOKENS_WITHOUT_THINKING = 2048;

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function buildPrompt(input: ExtractorInput, options: { trimInput: boolean }): string {
  const lines = options.trimInput ? trimLinesForModel(input.textLines) : input.textLines;
  return [
    "Extract invoice or receipt header fields from the document text below.",
    "Return only structured JSON matching the schema.",
    "Parties have no roles — list every party you see, without labelling supplier or customer.",
    "Use ISO dates YYYY-MM-DD. Amounts as printed (decimal string).",
    // No folder month here: Qwen3 0.6B copied `2026_05` into the document
    // number. The checks, not the model, compare dates with the month.
    // No glossary of Slovak labels either: it fixed Qwen3 4B's one silent
    // date error but cost it three other fields (ADR 0017, 2026-09-29).
    "",
    lines.join("\n"),
  ].join("\n");
}

function mapResponseBody(body: ModelExtractionResponseBody): ModelExtractedPayload {
  let amountCents: number | null = null;
  let amountLiteral: string | null = null;
  const totalLiteral = normalizeModelAmountLiteral(body.totalLiteral);
  if (totalLiteral) {
    const parsed = parseSignedDecimalAmount(totalLiteral);
    if (!("ok" in parsed)) {
      amountLiteral = parsed.literal;
      amountCents = parsed.cents;
    }
  }

  const vatRecap = body.vatRecap.map((row) => {
    const baseLiteral = normalizeModelAmountLiteral(row.baseLiteral) ?? row.baseLiteral;
    const vatLiteral = normalizeModelAmountLiteral(row.vatLiteral) ?? row.vatLiteral;
    const base = parseSignedDecimalAmount(baseLiteral);
    const vat = parseSignedDecimalAmount(vatLiteral);
    // An unreadable literal keeps its text with 0 cents; the checks flag the
    // recap when a literal does not match its cents.
    return {
      rateLiteral: row.rateLiteral,
      baseLiteral: "ok" in base ? baseLiteral : base.literal,
      baseCents: "ok" in base ? 0 : base.cents,
      vatLiteral: "ok" in vat ? vatLiteral : vat.literal,
      vatCents: "ok" in vat ? 0 : vat.cents,
    };
  });

  return {
    kind: "extracted",
    source: "model",
    parties: body.parties.map((party) => ({
      name: normalizeModelPartyName(party.name),
      ico: normalizeModelIco(party.ico),
      dic: normalizeModelDic(party.dic),
      icDph: normalizeModelIcDph(party.icDph),
    })),
    documentNumber: normalizeModelDocumentNumber(body.documentNumber),
    variableSymbol: normalizeModelVariableSymbol(body.variableSymbol),
    issueDate: normalizeModelDate(body.issueDate),
    taxableSupplyDate: normalizeModelDate(body.taxableSupplyDate),
    dueDate: normalizeModelDate(body.dueDate),
    currency: normalizeModelCurrency(body.currency),
    amountCents,
    amountLiteral,
    vatRecap,
    docTypeHint: (body.docTypeHint ?? null) as DocTypeHint | null,
  };
}

function parseChatCompletionContent(raw: unknown): ModelExtractionResponseBody | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const envelope = raw as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = envelope.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content) as ModelExtractionResponseBody;
  } catch {
    return null;
  }
}

function completionTokensOf(raw: unknown): number | undefined {
  const usage = (raw as { usage?: { completion_tokens?: unknown } } | null)?.usage;
  return typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
}

type StreamChunk = {
  choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
  usage?: { completion_tokens?: unknown };
  /** llama.cpp with `return_progress`: how much of the prompt it has read. */
  prompt_progress?: { total?: number; processed?: number };
  error?: { message?: string };
};

/**
 * A streamed completion (server-sent events) folded back into the shape of a
 * plain one. Streaming keeps the connection alive token by token: unstreamed,
 * no headers came until the model finished, and Node's fetch gives up after
 * 300 s without headers — a thinking model took longer and the document was
 * taken for an unreachable extractor, retried for ever.
 */
async function readStreamedCompletion(
  response: Response,
  onProgress?: (progress: ExtractorProgress) => void,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let generated = 0;
  let usage: StreamChunk["usage"];
  let prompt: StreamChunk["prompt_progress"];
  const readLine = (line: string) => {
    const data = line.trim().replace(/^data:\s*/, "");
    if (!line.trim().startsWith("data:") || data === "[DONE]") {
      return;
    }
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.error) {
      throw new Error(`Extractor error: ${chunk.error.message ?? "unknown"}`);
    }
    const delta = chunk.choices?.[0]?.delta;
    const generatedBefore = generated;
    if (delta?.content || delta?.reasoning_content) {
      content += delta.content ?? "";
      generated += 1;
    }
    usage = chunk.usage ?? usage;
    if (onProgress && (chunk.prompt_progress || generated !== generatedBefore)) {
      prompt = chunk.prompt_progress ?? prompt;
      onProgress({
        ...(typeof prompt?.total === "number" ? { promptTotal: prompt.total } : {}),
        ...(typeof prompt?.processed === "number" ? { promptProcessed: prompt.processed } : {}),
        generatedTokens: generated,
      });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    lines.forEach(readLine);
    if (done) {
      break;
    }
  }
  // Each streamed delta is one token when the server sends no usage.
  const completionTokens =
    typeof usage?.completion_tokens === "number" ? usage.completion_tokens : generated;
  return { choices: [{ message: { content } }], usage: { completion_tokens: completionTokens } };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function createHttpExtractor(options: HttpExtractorOptions): Extractor {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = chatCompletionsUrl(options.baseUrl);

  return {
    async extract(input: ExtractorInput): Promise<ExtractorOutput> {
      const started = Date.now();
      const body: Record<string, unknown> = {
        model: options.model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: buildPrompt(input, { trimInput: options.trimInput !== false }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: MODEL_EXTRACTED_JSON_SCHEMA,
        },
      };
      // llama.cpp (with --jinja) passes these to the model's chat template.
      // Hybrid models such as Qwen3 think by default, so "off" is sent too.
      body.chat_template_kwargs = { enable_thinking: options.thinkingEnabled === true };
      // llama.cpp reuses the previous request's matching prompt prefix, and its
      // logits are not bit-identical across batch sizes: her issued invoices
      // share a long opening, so an answer depended on which document came
      // before. Each document is read once, so recomputing costs nothing.
      body.cache_prompt = false;
      body.stream = true;
      body.stream_options = { include_usage: true };
      if (input.onProgress) {
        // llama.cpp streams how much of the prompt it has read, which on CPU
        // is half the wait; other servers ignore the field.
        body.return_progress = true;
      }
      const maxTokens =
        options.maxTokens ??
        (options.thinkingEnabled === true ? undefined : DEFAULT_MAX_TOKENS_WITHOUT_THINKING);
      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
      }

      const timeoutMs = options.timeoutMs ?? DEFAULT_EXTRACTOR_TIMEOUT_MS;
      let raw: unknown;
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": EXTRACTOR_USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          // The server's reason, so a request it refuses says why.
          const reason = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
          throw new Error(`Extractor HTTP ${response.status}${reason ? `: ${reason}` : ""}`);
        }

        // A server that ignores `stream` answers with one JSON body.
        raw = (response.headers.get("content-type") ?? "").includes("text/event-stream")
          ? await readStreamedCompletion(response, input.onProgress)
          : await response.json();
      } catch (error) {
        if (isTimeout(error)) {
          // Not "unreachable": the model is up, this document is too long for it.
          throw new Error(
            `The model took longer than ${Math.round(timeoutMs / 1000)} s on this document.`,
          );
        }
        throw error;
      }
      const parsed = parseChatCompletionContent(raw);
      if (!parsed) {
        throw new Error("Extractor returned no parseable JSON content");
      }

      return {
        durationMs: Date.now() - started,
        payload: mapResponseBody(parsed),
        completionTokens: completionTokensOf(raw),
      };
    },
  };
}
