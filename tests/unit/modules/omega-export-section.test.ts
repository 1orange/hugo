import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExportSection } from "../../../src/modules/omega-export-section.ts";
import { emptyConfirmedPayload } from "../../../src/modules/document-payload.ts";

test("resolveExportSection routes by doc type and folder", () => {
  assert.equal(
    resolveExportSection({
      extracted: { kind: "ekasa", currency: "EUR", lineItems: [], vatRecap: [] },
      confirmed: emptyConfirmedPayload(),
      folderSlot: "05 Bločky_firemná karta",
    }),
    "T00",
  );
  assert.equal(
    resolveExportSection({
      extracted: {
        kind: "extracted",
        parties: [],
        currency: "EUR",
        vatRecap: [],
        docTypeHint: "invoice",
      },
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
