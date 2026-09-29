import { test } from "node:test";
import assert from "node:assert/strict";
import { checkViesVatNumber } from "../../../src/adapters/vat-register/vies-client.ts";

// Answers as the VIES REST API gave them on 2026-09-29.
function vies(body: unknown, status = 200, urls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    urls.push(String(input));
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as typeof fetch;
}

test("a registered VAT ID is valid, with the registered name", async () => {
  const urls: string[] = [];
  const check = await checkViesVatNumber(
    "SK2023141351",
    vies({ isValid: true, userError: "VALID", name: "SPRING.etc., spol. s r. o." }, 200, urls),
  );
  assert.deepEqual(check, { valid: true, name: "SPRING.etc., spol. s r. o." });
  assert.equal(urls[0], "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/SK/vat/2023141351");
});

test("an unregistered VAT ID is not valid", async () => {
  assert.deepEqual(
    await checkViesVatNumber("SK2020372640", vies({ isValid: false, userError: "INVALID", name: "" })),
    { valid: false },
  );
});

test("a member state that does not answer is an error, not an invalid number", async () => {
  await assert.rejects(
    checkViesVatNumber("SK2023141351", vies({ isValid: false, userError: "MS_UNAVAILABLE" })),
    /MS_UNAVAILABLE/,
  );
  await assert.rejects(checkViesVatNumber("SK2023141351", vies({}, 503)), /VIES HTTP 503/);
});

test("a name VIES withholds is null", async () => {
  assert.deepEqual(await checkViesVatNumber("SK2023141351", vies({ isValid: true, name: "---" })), {
    valid: true,
    name: null,
  });
});
