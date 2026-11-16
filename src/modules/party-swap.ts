import type { EditorScalarFieldChecks } from "./editor-field-checks";
import type { PartyField, PartySource, PartyValueProvenance } from "./party-enrichment";

/**
 * Swapping *Dodávateľ* and *Odberateľ*: the four identity fields of each side
 * exchange places together with their provenance badges. Pure, so the panel's
 * optimistic state and the server's persisted state come from one rule.
 */

export const PARTY_SWAP_PAIRS = [
  ["supplierName", "customerName"],
  ["ico", "customerIco"],
  ["dic", "customerDic"],
  ["icDph", "customerIcDph"],
] as const;

export type PartySwapField = (typeof PARTY_SWAP_PAIRS)[number][number];

export const PARTY_SWAP_FIELDS: readonly PartySwapField[] = PARTY_SWAP_PAIRS.flat();

export type PartySwapValues = Record<PartySwapField, string>;
export type PartySwapProvenance = Record<PartySwapField, PartyValueProvenance>;

/** Exchanges a key pair; a key absent on one side stays absent on the other. */
function exchange<T extends object>(record: T, left: string, right: string): T {
  const source = record as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  const hasLeft = Object.prototype.hasOwnProperty.call(source, left);
  const hasRight = Object.prototype.hasOwnProperty.call(source, right);
  if (hasRight) {
    next[left] = source[right];
  } else {
    delete next[left];
  }
  if (hasLeft) {
    next[right] = source[left];
  } else {
    delete next[right];
  }
  return next as T;
}

/**
 * Exchanges supplier and customer in both the values and their provenance.
 * Every other key is copied as it was. Applying it twice gives the input back.
 */
export function swapParties<D extends object, P extends object>(
  draft: D,
  provenance: P,
): { draft: D; provenance: P } {
  let swappedDraft = draft;
  let swappedProvenance = provenance;
  for (const [left, right] of PARTY_SWAP_PAIRS) {
    swappedDraft = exchange(swappedDraft, left, right);
    swappedProvenance = exchange(swappedProvenance, left, right);
  }
  return { draft: swappedDraft, provenance: swappedProvenance };
}

/** Only the eight party entries of a provenance map: what a swap persists. */
export function pickPartyProvenance(provenance: Record<string, string>): PartySwapProvenance {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, provenance[field]]),
  ) as PartySwapProvenance;
}

/**
 * Provenance after the accountant's own edits: a party value she changed
 * since the document last showed it is hers now, whatever its source was.
 * Other entries of the map are returned as they were.
 */
export function confirmEditedPartyProvenance<P extends object>(
  values: Partial<PartySwapValues>,
  shown: Partial<PartySwapValues>,
  provenance: P,
): P {
  const next: Record<string, unknown> = { ...(provenance as Record<string, unknown>) };
  for (const field of PARTY_SWAP_FIELDS) {
    if (values[field] !== shown[field]) {
      next[field] = "confirmed";
    }
  }
  return next as P;
}

/** One side of the parties as the role and enrichment checks read it. */
export function partySideSource(
  values: PartySwapValues,
  provenance: PartySwapProvenance,
  role: "supplier" | "customer",
): PartySource {
  const fields: Array<[PartyField, PartySwapField]> =
    role === "supplier"
      ? [
          ["name", "supplierName"],
          ["ico", "ico"],
          ["dic", "dic"],
          ["icDph", "icDph"],
        ]
      : [
          ["name", "customerName"],
          ["ico", "customerIco"],
          ["dic", "customerDic"],
          ["icDph", "customerIcDph"],
        ];
  return Object.fromEntries(
    fields.map(([party, field]) => [
      party,
      {
        value: values[field],
        provenance: values[field].length > 0 ? provenance[field] : "empty",
      },
    ]),
  ) as PartySource;
}

/**
 * Extraction flags are read per printed party for the role it had when they
 * ran; once the sides are swapped they no longer describe the side she sees.
 */
export function withoutPartyChecks(
  checks: EditorScalarFieldChecks | null,
): EditorScalarFieldChecks | null {
  if (checks === null) {
    return null;
  }
  const next: EditorScalarFieldChecks = { ...checks };
  for (const field of PARTY_SWAP_FIELDS) {
    delete next[field];
  }
  return next;
}
