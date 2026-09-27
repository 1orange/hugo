import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExportSection } from "../../../src/modules/omega-export-section.ts";
import {
  emptyConfirmedPayload,
  type ExtractedPayload,
} from "../../../src/modules/document-payload.ts";

/** Routing reads only `kind` and `docTypeHint`; the rest of a payload is irrelevant here. */
function payload(fields: Record<string, unknown>): ExtractedPayload {
  return fields as ExtractedPayload;
}

test("resolveExportSection routes by doc type and folder", () => {
  assert.equal(
    resolveExportSection({
      extracted: payload({ kind: "ekasa", currency: "EUR", lineItems: [], vatRecap: [] }),
      confirmed: emptyConfirmedPayload(),
      folderSlot: "05 Bločky_firemná karta",
    }),
    "T00",
  );
  assert.equal(
    resolveExportSection({
      extracted: payload({
        kind: "extracted",
        parties: [],
        currency: "EUR",
        vatRecap: [],
        docTypeHint: "invoice",
      }),
      confirmed: emptyConfirmedPayload(),
      folderSlot: "05 Bločky_firemná karta",
    }),
    "T01",
  );
  assert.equal(
    resolveExportSection({
      extracted: {},
      confirmed: { exportSection: "T00" },
      folderSlot: "01 Vystavené faktúry",
    }),
    "T00",
  );
});
