import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpExtractor,
  EXTRACTOR_USER_AGENT,
} from "../../../src/adapters/extractor/http-extractor.ts";
import { MODEL_EXTRACTED_JSON_SCHEMA } from "../../../src/adapters/extractor/model-extracted-schema.ts";

test("HTTP extractor requests JSON schema constrained chat completion", async () => {
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  let seenUserAgent = "";

  const extractor = createHttpExtractor({
    baseUrl: "http://127.0.0.1:8080",
    model: "test-model",
    fetchImpl: async (url, init) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seenUserAgent = String(
        init?.headers && (init.headers as Record<string, string>)["User-Agent"],
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  parties: [
                    {
                      name: "Dodávateľ s.r.o.",
                      ico: "31333532",
                      dic: "2020313335",
                      icDph: "SK7120001713",
                    },
                  ],
                  documentNumber: "20260042",
                  variableSymbol: "20260042",
                  issueDate: "2026-05-07",
                  taxableSupplyDate: "2026-05-07",
                  dueDate: null,
                  currency: "EUR",
                  totalLiteral: "33.00",
                  vatRecap: [
                    {
                      rateLiteral: "23",
                      baseLiteral: "26.83",
                      vatLiteral: "6.17",
                    },
                  ],
                  docTypeHint: "invoice",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const result = await extractor.extract({
    driveFileId: "drive-1",
    monthKey: "2026_05",
    textLines: ["FA 20260042", "Celkom 33.00 EUR"],
  });

  assert.equal(seenUrl, "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(seenBody.model, "test-model");
  const responseFormat = seenBody.response_format as {
    type: string;
    json_schema: typeof MODEL_EXTRACTED_JSON_SCHEMA;
  };
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.name, "extracted_document");
  assert.equal(seenUserAgent, EXTRACTOR_USER_AGENT);

  assert.equal(result.payload.kind, "extracted");
  assert.equal(result.payload.documentNumber, "20260042");
  assert.equal(result.payload.parties.length, 1);
  assert.equal(result.payload.parties[0]?.ico, "31333532");
  assert.equal("role" in (result.payload.parties[0] ?? {}), false);
  assert.equal(result.payload.amountCents, 3300);
  assert.equal(result.payload.vatRecap[0]?.baseCents, 2683);
});

test("thinking mode is off unless enabled in options", async () => {
  let seenBody: Record<string, unknown> = {};
  const extractor = createHttpExtractor({
    baseUrl: "http://127.0.0.1:8080",
    model: "test-model",
    thinkingEnabled: true,
    fetchImpl: async (_url, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(minimalModelJson()) } }],
        }),
        { status: 200 },
      );
    },
  });

  await extractor.extract({
    driveFileId: "d",
    monthKey: "2026_05",
    textLines: ["x"],
  });
  assert.equal(seenBody.enable_thinking, true);
});

function minimalModelJson() {
  return {
    parties: [],
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    totalLiteral: null,
    vatRecap: [],
    docTypeHint: null,
  };
}
