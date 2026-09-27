import { FakeEkasaLookup } from "@/adapters/ekasa-lookup/fake-ekasa-lookup";
import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";

/** Shared with E2E specs and the synthetic unit corpus — not real client data. */
export const E2E_RESOLVABLE_EKASA_UID = "O-11111111111111111111111111111111";

function e2eSyntheticOpdResponse(): unknown {
  return {
    returnValue: 0,
    receipt: {
      receiptId: E2E_RESOLVABLE_EKASA_UID,
      okp: "AAAA1111-22222222-33333333-44444444-55555555",
      issueDate: "16.04.2026 14:05:59",
      createDate: "16.04.2026 14:05:59",
      dic: "1234567890",
      ico: "12345678",
      icDph: "SK1234567890",
      cashRegisterCode: "88812345678900001",
      receiptNumber: 100,
      totalPrice: 16.85,
      items: [
        {
          name: "Sample item alpha",
          itemType: "K",
          quantity: 5,
          vatRate: 23,
          price: 4.95,
        },
        {
          name: "Sample item beta",
          itemType: "K",
          quantity: 10,
          vatRate: 23,
          price: 11.9,
        },
      ],
      organization: {
        name: "Test Retail / Test Bratislava, s.r.o.",
      },
    },
  };
}

/** E2E and fake Drive — one known UID resolves to the synthetic OPD envelope. */
export function createE2eFakeEkasaLookup(): EkasaLookup {
  return new FakeEkasaLookup({
    responses: {
      [E2E_RESOLVABLE_EKASA_UID]: { ok: true, raw: e2eSyntheticOpdResponse() },
    },
  });
}
