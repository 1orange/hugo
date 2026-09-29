import type { DocumentParty } from "./document-payload";
import { normalizeModelIcDph } from "./model-output-normalize";
import { clientPartyIndex, type ClientIdentity } from "./party-roles";

// A VAT number as printed: the country's prefix, perhaps a space, the number.
// normalizeModelIcDph decides what really is one.
const PRINTED_VAT_NUMBER =
  /\b(?:SK ?\d{10}|CZ ?\d{8,10}|(?:AT|BE|BG|CY|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|NO|PL|PT|RO|SE|SI|XI) ?[0-9A-Z]{2,13})\b/g;

/**
 * The counterparty's IČ DPH from the text, when the model missed it and the
 * text prints exactly one VAT number that is neither hers nor any party's.
 * MODIVO prints its own as "DIČ: SK4120004493"; Qwen3 4B returned the
 * waste-register number beside it. OpenAI's "IE VAT IE4143435AH" went
 * missing too. Only a document with her company and one other party.
 */
export function fillCounterpartyIcDph(
  parties: DocumentParty[],
  lines: readonly string[],
  client: ClientIdentity,
): DocumentParty[] {
  const clientIndex = parties.length === 2 ? clientPartyIndex(parties, client) : null;
  if (clientIndex === null) {
    return parties;
  }
  const otherIndex = clientIndex === 0 ? 1 : 0;
  if (parties[otherIndex]!.icDph) {
    return parties;
  }
  const known = new Set(
    [client.icDph, client.dic, ...parties.flatMap((party) => [party.icDph, party.dic])]
      .map((value) => normalizeModelIcDph(value))
      .filter((value): value is string => value !== null),
  );
  const printed = new Set(
    (lines.join("\n").toUpperCase().match(PRINTED_VAT_NUMBER) ?? [])
      .map((value) => normalizeModelIcDph(value))
      .filter((value): value is string => value !== null && !known.has(value)),
  );
  if (printed.size !== 1) {
    return parties;
  }
  const [icDph] = printed;
  return parties.map((party, index) => (index === otherIndex ? { ...party, icDph: icDph! } : party));
}
