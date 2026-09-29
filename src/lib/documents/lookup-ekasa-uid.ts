import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";
import { appendUserEvent } from "@/adapters/store/events";
import {
  getDocument,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  hasEkasaLookupPayload,
  isEkasaPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
  withTypedEkasaUid,
} from "@/modules/document-payload";
import {
  EKASA_UID_NOT_FOUND_MESSAGE,
  validateEkasaUidInput,
} from "@/modules/ekasa-identifiers";
import { mapOpdResponseToEkasaPayload } from "@/modules/ekasa-lookup-mapping";
import { deriveReceiptKind } from "@/modules/document-state";

export type EkasaUidLookupResult =
  | { ok: true; found: true }
  | { ok: true; found: false; message: string }
  | { ok: false; message: string };

async function storeTypedUidOnly(documentId: string, uid: string): Promise<void> {
  const document = await getDocument(documentId);
  const payload = parseExtractedPayload(document?.extractedPayloadJson ?? "{}");
  await writeExtractedPayload(
    documentId,
    withTypedEkasaUid(payload, uid),
    document?.extractionStatus === "pending"
      ? "pending"
      : (document?.extractionStatus as "complete" | "failed") ?? "failed",
    document?.extractionFailureReason ?? null,
  );
}

export async function lookupEkasaUidForDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  uidRaw: string;
  ekasaLookup: EkasaLookup;
  now?: string;
}): Promise<EkasaUidLookupResult> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const validated = validateEkasaUidInput(input.uidRaw);
  if (!validated.ok) {
    return validated;
  }
  const uid = validated.uid;

  const document = await getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  if (deriveReceiptKind(document.folderSlot) === null) {
    return { ok: false, message: "UID sa zadáva len pre bločky v 04 alebo 05." };
  }

  const existingPayload = parseExtractedPayload(document.extractedPayloadJson);
  if (hasEkasaLookupPayload(existingPayload)) {
    return { ok: false, message: "Doklad už má údaje z Finančnej správy." };
  }

  const confirmedBefore = parseConfirmedPayload(document.confirmedPayloadJson);
  const now = input.now ?? new Date().toISOString();

  const cachedOpdResponse =
    isEkasaPayload(existingPayload) && existingPayload.opdResponse !== undefined
      ? existingPayload.opdResponse
      : undefined;

  let lookupRaw: unknown;
  if (cachedOpdResponse !== undefined) {
    lookupRaw = cachedOpdResponse;
  } else {
    const lookup = await input.ekasaLookup.findReceipt(uid);
    if (!lookup.ok) {
      await storeTypedUidOnly(input.documentId, uid);
      await appendUserEvent(now, input.companyId, "EkasaUidEntered", {
        monthKey: input.monthKey,
        driveFileId: document.driveFileId,
      documentId: document.id,
        uid,
        found: false,
      });
      return { ok: true, found: false, message: EKASA_UID_NOT_FOUND_MESSAGE };
    }
    lookupRaw = lookup.raw;
  }

  const mapped = mapOpdResponseToEkasaPayload({
    requestedUid: uid,
    raw: lookupRaw,
  });
  if (!mapped.ok) {
    await storeTypedUidOnly(input.documentId, uid);
    await appendUserEvent(now, input.companyId, "EkasaUidEntered", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
      uid,
      found: false,
    });
    return { ok: true, found: false, message: EKASA_UID_NOT_FOUND_MESSAGE };
  }

  const payload = mapped.payload;

  if (payload.currency !== "EUR") {
    await writeExtractedPayload(
      input.documentId,
      { ...payload, typedEkasaUid: uid },
      "failed",
      `Receipt is in ${payload.currency} — enter the EUR amount manually.`,
    );
    await appendUserEvent(now, input.companyId, "EkasaUidEntered", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
      uid,
      found: true,
      source: "lookup",
      status: "failed",
    });
    return {
      ok: false,
      message: `Bloček je v mene ${payload.currency} — zadaj sumu v EUR ručne.`,
    };
  }

  await writeExtractedPayload(
    input.documentId,
    { ...payload, typedEkasaUid: uid },
    "complete",
    null,
  );

  const confirmedAfter = parseConfirmedPayload(
    (await getDocument(input.documentId))?.confirmedPayloadJson ?? "{}",
  );
  if (JSON.stringify(confirmedBefore) !== JSON.stringify(confirmedAfter)) {
    throw new Error("Confirmed payload changed during eKasa UID lookup.");
  }

  await appendUserEvent(now, input.companyId, "EkasaUidEntered", {
    monthKey: input.monthKey,
    driveFileId: document.driveFileId,
    documentId: document.id,
    uid,
    found: true,
    source: "lookup",
    status: "complete",
  });

  return { ok: true, found: true };
}
