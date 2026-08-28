import { parseEuroAmount } from "./money";
import {
  bratislavaLocalToUtcIso,
  parseEkasaTimestampRaw,
  type EkasaLocalTimestamp,
} from "./ekasa-timestamp";

export type EkasaUidReceipt = {
  variant: "uid";
  uid: string;
  payload: string;
};

export type EkasaCompositeReceipt = {
  variant: "composite";
  okp: string;
  registerCode: string;
  timestamp: EkasaLocalTimestamp;
  receiptAtUtc: string;
  sequenceNumber: string;
  amountCents: number;
  amountLiteral: string;
  payload: string;
};

export type EkasaReceipt = EkasaUidReceipt | EkasaCompositeReceipt;

export type EkasaParseError = {
  ok: false;
  reason: string;
};

export type EkasaParseResult = EkasaReceipt | EkasaParseError;

const UID_PATTERN = /^[OV]-[0-9A-Fa-f]{32}$/;
const OKP_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}$/;
const REGISTER_PATTERN = /^\d{16,17}$/;

function parseFailure(reason: string): EkasaParseError {
  return { ok: false, reason };
}

function parseUidVariant(payload: string): EkasaParseResult {
  if (!UID_PATTERN.test(payload)) {
    return parseFailure("UID payload must be 34 characters: O- or V- plus 32 hex digits.");
  }

  return {
    variant: "uid",
    uid: payload,
    payload,
  };
}

function parseCompositeFields(
  okp: string,
  registerCode: string,
  timestampRaw: string,
  sequenceNumber: string,
  amountLiteral: string,
  payload: string,
): EkasaParseResult {
  if (!OKP_PATTERN.test(okp)) {
    return parseFailure("OKP must be 44 characters in 8-8-8-8-8 hex groups.");
  }
  if (!REGISTER_PATTERN.test(registerCode)) {
    return parseFailure("Register code must be 16 or 17 digits.");
  }
  if (sequenceNumber.length < 1 || sequenceNumber.length > 6) {
    return parseFailure("Sequence number must be 1–6 characters.");
  }
  if (!/^\d{1,6}$/.test(sequenceNumber)) {
    return parseFailure("Sequence number must be numeric.");
  }

  const timestamp = parseEkasaTimestampRaw(timestampRaw);
  if ("ok" in timestamp) {
    return parseFailure(timestamp.reason);
  }

  const amount = parseEuroAmount(amountLiteral);
  if ("ok" in amount) {
    return parseFailure(amount.reason);
  }

  return {
    variant: "composite",
    okp,
    registerCode,
    timestamp,
    receiptAtUtc: bratislavaLocalToUtcIso(timestamp),
    sequenceNumber,
    amountCents: amount.cents,
    amountLiteral: amount.literal,
    payload,
  };
}

function parseColonComposite(payload: string): EkasaParseResult {
  const parts = payload.split(":");
  if (parts.length !== 5) {
    return parseFailure("Composite payload must contain exactly four colon separators.");
  }

  const [okp, registerCode, timestampRaw, sequenceNumber, amountLiteral] = parts;
  if (!okp || !registerCode || !timestampRaw || !sequenceNumber || !amountLiteral) {
    return parseFailure("Composite payload has empty fields.");
  }

  return parseCompositeFields(
    okp,
    registerCode,
    timestampRaw,
    sequenceNumber,
    amountLiteral,
    payload,
  );
}

function parseConcatenatedComposite(payload: string): EkasaParseResult {
  if (payload.length < 74 || payload.length > 91) {
    return parseFailure("Concatenated composite payload length is out of range.");
  }

  const okp = payload.slice(0, 44);
  if (!OKP_PATTERN.test(okp)) {
    return parseFailure("Composite payload does not start with a valid OKP.");
  }

  const rest = payload.slice(44);
  const matches: EkasaCompositeReceipt[] = [];

  for (const registerLength of [17, 16] as const) {
    if (rest.length < registerLength + 12 + 1 + 1) {
      continue;
    }

    const registerCode = rest.slice(0, registerLength);
    const timestampRaw = rest.slice(registerLength, registerLength + 12);
    if (!/^\d{12}$/.test(timestampRaw)) {
      continue;
    }

    const tail = rest.slice(registerLength + 12);
    for (let sequenceLength = 1; sequenceLength <= 6; sequenceLength += 1) {
      if (tail.length < sequenceLength + 1) {
        continue;
      }

      const sequenceNumber = tail.slice(0, sequenceLength);
      const amountLiteral = tail.slice(sequenceLength);
      if (amountLiteral.length < 1 || amountLiteral.length > 12) {
        continue;
      }

      const parsed = parseCompositeFields(
        okp,
        registerCode,
        timestampRaw,
        sequenceNumber,
        amountLiteral,
        payload,
      );
      if ("variant" in parsed && parsed.variant === "composite") {
        matches.push(parsed);
      }
    }
  }

  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    return parseFailure("Composite payload is ambiguous at field boundaries.");
  }

  return parseFailure("Composite payload could not be split at field boundaries.");
}

/**
 * Map a decoded eKasa QR payload string to receipt facts. No file access, no
 * network, no clock — only the payload string.
 */
export function parseEkasaQr(payload: string): EkasaParseResult {
  const trimmed = payload.trim();
  if (trimmed.length === 0) {
    return parseFailure("Payload is empty.");
  }

  if (UID_PATTERN.test(trimmed)) {
    return parseUidVariant(trimmed);
  }

  if (trimmed.includes(":")) {
    return parseColonComposite(trimmed);
  }

  if (trimmed.length >= 74) {
    return parseConcatenatedComposite(trimmed);
  }

  return parseFailure("Payload does not match a known eKasa QR variant.");
}

export function ekasaReceiptHasAmount(receipt: EkasaReceipt): receipt is EkasaCompositeReceipt {
  return receipt.variant === "composite";
}
