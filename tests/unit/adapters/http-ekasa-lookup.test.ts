import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpEkasaLookup,
  EKASA_LOOKUP_USER_AGENT,
  EKASA_OPD_FIND_URL,
} from "../../../src/adapters/ekasa-lookup/http-ekasa-lookup.ts";

test("HTTP adapter sends app User-Agent and serializes requests", async () => {
  const userAgents: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const lookup = createHttpEkasaLookup(async (_url, init) => {
    userAgents.push(String(init?.headers && (init.headers as Record<string, string>)["User-Agent"]));
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return new Response(
      JSON.stringify({
        returnValue: 0,
        receipt: {
          receiptId: "O-11111111111111111111111111111111",
          issueDate: "16.04.2026 14:05:59",
          totalPrice: 1,
          items: [{ name: "A", itemType: "K", quantity: 1, vatRate: 23, price: 1 }],
          organization: { name: "Shop" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const [first, second] = await Promise.all([
    lookup.findReceipt("O-11111111111111111111111111111111"),
    lookup.findReceipt("O-22222222222222222222222222222222"),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(maxInFlight, 1);
  assert.ok(userAgents.every((ua) => ua === EKASA_LOOKUP_USER_AGENT));
});

test("HTTP adapter posts to the OPD find endpoint", async () => {
  let seenUrl = "";
  let seenBody = "";

  const lookup = createHttpEkasaLookup(async (url, init) => {
    seenUrl = String(url);
    seenBody = String(init?.body);
    return new Response(JSON.stringify({ returnValue: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await lookup.findReceipt("O-11111111111111111111111111111111");
  assert.equal(result.ok, false);
  assert.equal(seenUrl, EKASA_OPD_FIND_URL);
  assert.deepEqual(JSON.parse(seenBody), {
    receiptId: "O-11111111111111111111111111111111",
  });
});
