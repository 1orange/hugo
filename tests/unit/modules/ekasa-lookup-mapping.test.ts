import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpdResponseToEkasaPayload } from "../../../src/modules/ekasa-lookup-mapping.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";

test("maps synthetic OPD response to ekasa payload with lookup source", () => {
  const mapped = mapOpdResponseToEkasaPayload({
    requestedUid: SYNTHETIC_FIXTURE.uid,
    raw: syntheticEkasaOpdResponse(),
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) {
    return;
  }
  assert.equal(mapped.payload.source, "lookup");
  assert.equal(mapped.payload.amountCents, SYNTHETIC_FIXTURE.totalCents);
  assert.equal(
    (mapped.payload.recapBaseCents ?? 0) + (mapped.payload.recapVatCents ?? 0),
    SYNTHETIC_FIXTURE.totalCents,
  );
  assert.equal(mapped.payload.vatRecap.length, 1);
  assert.ok(mapped.payload.opdResponse);
});

test("23 and 23.0 aggregate to one VAT rate", () => {
  const mapped = mapOpdResponseToEkasaPayload({
    requestedUid: "O-11111111111111111111111111111111",
    raw: {
      returnValue: 0,
      receipt: {
        receiptId: "O-11111111111111111111111111111111",
        issueDate: "16.04.2026 14:05:59",
        totalPrice: 16.85,
        items: [
          { name: "A", itemType: "K", quantity: 1, vatRate: 23, price: 4.95 },
          { name: "B", itemType: "K", quantity: 1, vatRate: 23.0, price: 11.9 },
        ],
        organization: { name: "Shop" },
      },
    },
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) {
    return;
  }
  assert.equal(mapped.payload.vatRecap.length, 1);
  assert.equal(
    mapped.payload.vatRecap[0]!.baseCents + mapped.payload.vatRecap[0]!.vatCents,
    1685,
  );
});

test("discount item reduces the total", () => {
  const mapped = mapOpdResponseToEkasaPayload({
    requestedUid: "O-22222222222222222222222222222222",
    raw: {
      returnValue: 0,
      receipt: {
        receiptId: "O-22222222222222222222222222222222",
        issueDate: "16.04.2026 14:05:59",
        totalPrice: 9.0,
        items: [
          { name: "Goods", itemType: "K", quantity: 1, vatRate: 23, price: 10.0 },
          { name: "Discount", itemType: "Z", quantity: 1, vatRate: 23, price: -1.0 },
        ],
        organization: { name: "Shop" },
      },
    },
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) {
    return;
  }
  assert.equal(mapped.payload.amountCents, 900);
});

test("rejects mismatched receiptId and item sum", () => {
  const wrongId = mapOpdResponseToEkasaPayload({
    requestedUid: "O-11111111111111111111111111111111",
    raw: {
      returnValue: 0,
      receipt: {
        receiptId: "O-99999999999999999999999999999999",
        issueDate: "16.04.2026 14:05:59",
        totalPrice: 10,
        items: [{ name: "A", itemType: "K", quantity: 1, vatRate: 23, price: 10 }],
        organization: { name: "Shop" },
      },
    },
  });
  assert.equal(wrongId.ok, false);

  const badSum = mapOpdResponseToEkasaPayload({
    requestedUid: "O-11111111111111111111111111111111",
    raw: {
      returnValue: 0,
      receipt: {
        receiptId: "O-11111111111111111111111111111111",
        issueDate: "16.04.2026 14:05:59",
        totalPrice: 10,
        items: [{ name: "A", itemType: "K", quantity: 1, vatRate: 23, price: 9 }],
        organization: { name: "Shop" },
      },
    },
  });
  assert.equal(badSum.ok, false);
});
