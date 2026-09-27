/** JSON Schema for OpenAI-compatible structured output (llama.cpp server / Ollama). */
export const MODEL_EXTRACTED_JSON_SCHEMA = {
  name: "extracted_document",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "parties",
      "documentNumber",
      "variableSymbol",
      "issueDate",
      "taxableSupplyDate",
      "dueDate",
      "currency",
      "totalLiteral",
      "vatRecap",
      "docTypeHint",
    ],
    properties: {
      parties: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "ico", "dic", "icDph"],
          properties: {
            name: { type: ["string", "null"] },
            ico: { type: ["string", "null"] },
            dic: { type: ["string", "null"] },
            icDph: { type: ["string", "null"] },
          },
        },
      },
      documentNumber: { type: ["string", "null"] },
      variableSymbol: { type: ["string", "null"] },
      issueDate: {
        type: ["string", "null"],
        description: "ISO calendar date YYYY-MM-DD",
      },
      taxableSupplyDate: { type: ["string", "null"] },
      dueDate: { type: ["string", "null"] },
      currency: { type: "string" },
      totalLiteral: { type: ["string", "null"] },
      vatRecap: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rateLiteral", "baseLiteral", "vatLiteral"],
          properties: {
            rateLiteral: { type: "string" },
            baseLiteral: { type: "string" },
            vatLiteral: { type: "string" },
          },
        },
      },
      docTypeHint: {
        type: ["string", "null"],
        enum: [
          "invoice",
          "receipt",
          "proforma",
          "credit_note",
          "advance_tax_document",
          "other",
          null,
        ],
      },
    },
  },
} as const;

export type ModelExtractionResponseBody = {
  parties: Array<{
    name: string | null;
    ico: string | null;
    dic: string | null;
    icDph: string | null;
  }>;
  documentNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  currency: string;
  totalLiteral: string | null;
  vatRecap: Array<{
    rateLiteral: string;
    baseLiteral: string;
    vatLiteral: string;
  }>;
  docTypeHint:
    | "invoice"
    | "receipt"
    | "proforma"
    | "credit_note"
    | "advance_tax_document"
    | "other"
    | null;
};
