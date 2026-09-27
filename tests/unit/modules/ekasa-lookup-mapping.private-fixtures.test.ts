import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mapOpdResponseToEkasaPayload } from "../../../src/modules/ekasa-lookup-mapping.ts";
import { parseEkasaText, validateEkasaArithmetic } from "../../../src/modules/ekasa-text.ts";
const PRIVATE_DIR = path.join(process.cwd(), "tests/private-fixtures/ekasa-opd");

function privateFixturesReady(): boolean {
  if (!fs.existsSync(PRIVATE_DIR)) {
    return false;
  }
  return fs.readdirSync(PRIVATE_DIR).some((name) => name.endsWith(".json"));
}

test(
  "OPD mapping matches printed recapitulation on private text-layer fixtures",
  { skip: privateFixturesReady() ? false : "tests/private-fixtures/ekasa-opd absent" },
  () => {
    const textDir = path.join(process.cwd(), "tests/private-fixtures/ekasa-text");
    const opdFiles = fs
      .readdirSync(PRIVATE_DIR)
      .filter((name) => name.endsWith(".json"));

    for (const fileName of opdFiles) {
      const stem = fileName.replace(/\.json$/, "");
      const opdRaw = JSON.parse(
        fs.readFileSync(path.join(PRIVATE_DIR, fileName), "utf8"),
      ) as unknown;
      const envelope = opdRaw as { receipt?: { receiptId?: string } };
      const uid = envelope.receipt?.receiptId;
      assert.ok(uid, `${fileName} missing receiptId`);

      const mapped = mapOpdResponseToEkasaPayload({ requestedUid: uid!, raw: opdRaw });
      assert.equal(mapped.ok, true, stem);

      const textPath = path.join(textDir, `${stem}.txt`);
      if (!fs.existsSync(textPath)) {
        continue;
      }
      const lines = fs.readFileSync(textPath, "utf8").split(/\r?\n/);
      const parsed = parseEkasaText(lines);
      assert.equal("ok" in parsed, false, stem);
      if ("ok" in parsed) {
        continue;
      }
      const arithmetic = validateEkasaArithmetic(parsed);
      assert.equal(arithmetic.ok, true, stem);

      if (!mapped.ok) {
        continue;
      }
      assert.equal(mapped.payload.recapBaseCents, parsed.recapSpoluBaseCents, stem);
      assert.equal(mapped.payload.recapVatCents, parsed.recapSpoluVatCents, stem);
      assert.equal(mapped.payload.amountCents, parsed.totalCents, stem);
    }
  },
);
