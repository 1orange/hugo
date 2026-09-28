import { parseSignedDecimalAmount } from "../../modules/money";
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
import type { Extractor, ExtractorInput, ExtractorOutput } from "./port";
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
  fetchImpl?: FetchLike;
};

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function buildPrompt(input: ExtractorInput): string {
  const text = input.textLines.join("\n");
  return [
    "Extract invoice or receipt header fields from the document text below.",
    "Return only structured JSON matching the schema.",
    "Parties have no roles — list every party you see, without labelling supplier or customer.",
    "Use ISO dates YYYY-MM-DD. Amounts as printed (decimal string).",
    "",
    `Document month folder: ${input.monthKey}`,
    "",
    text,
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
            content: buildPrompt(input),
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

      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": EXTRACTOR_USER_AGENT,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Extractor HTTP ${response.status}`);
      }

      const raw: unknown = await response.json();
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
