import { SYNTHETIC_FIXTURE } from "./synthetic-ekasa-lines.ts";

/** Synthetic OPD envelope — no real client data. */
export function syntheticEkasaOpdResponse(): unknown {
  return {
    returnValue: 0,
    receipt: {
      receiptId: SYNTHETIC_FIXTURE.uid,
      okp: SYNTHETIC_FIXTURE.okp,
      issueDate: SYNTHETIC_FIXTURE.timestampRaw,
      createDate: SYNTHETIC_FIXTURE.timestampRaw,
      dic: SYNTHETIC_FIXTURE.dic,
      ico: SYNTHETIC_FIXTURE.ico,
      icDph: SYNTHETIC_FIXTURE.icDph,
      cashRegisterCode: SYNTHETIC_FIXTURE.kp,
      receiptNumber: Number(SYNTHETIC_FIXTURE.receiptNumber),
      totalPrice: SYNTHETIC_FIXTURE.totalCents / 100,
      items: SYNTHETIC_FIXTURE.lineItems.map((item) => ({
        name: item.name,
        itemType: "K",
        quantity: Number(item.quantityLiteral),
        vatRate: Number(item.vatRateLiteral),
        price: item.lineTotalCents / 100,
      })),
      organization: {
        name: SYNTHETIC_FIXTURE.supplierName,
      },
    },
  };
}
