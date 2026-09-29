import type { DocumentParty } from "./document-payload";

// A company's legal form at the end of its name: "s. r. o.", "a. s.", "S.A.".
const LEGAL_FORM = /\b(?:s\.?\s?r\.?\s?o|a\.?\s?s|spol|k\.?\s?s|v\.?\s?o\.?\s?s|gmbh|ag|s\.?\s?a|ltd|limited|inc|llc|pbc)\.?\s*$/i;

function hasLegalForm(party: DocumentParty): boolean {
  return LEGAL_FORM.test((party.name ?? "").trim());
}

/**
 * Parties with one IČO are one company — on a receipt, which has one seller.
 * On an invoice the same IČO twice is a mistake to flag (a fine from the city
 * police given her IČO), so the checks merge only among the receipts. From a
 * parking ticket the model listed the seller twice — "CENTRAL Bratislava" and
 * "Central Shopping Center, a. s.", both 46872884 — and made the car's plate
 * a party with the seller's IČO. The name kept is the one with a legal form;
 * missing numbers are taken from the others. IČ DPH alone does not make one
 * company: a VAT group shares it (Slovnaft's SK7120001713).
 */
export function mergePartiesSharingIco(parties: DocumentParty[]): DocumentParty[] {
  const merged: DocumentParty[] = [];
  for (const party of parties) {
    const ico = party.ico?.replace(/\s/g, "") ?? "";
    const index = ico ? merged.findIndex((kept) => kept.ico?.replace(/\s/g, "") === ico) : -1;
    if (index < 0) {
      merged.push(party);
      continue;
    }
    const kept = merged[index]!;
    const named = !hasLegalForm(kept) && hasLegalForm(party) ? party : kept;
    merged[index] = {
      name: named.name ?? kept.name ?? party.name,
      ico: kept.ico,
      dic: kept.dic ?? party.dic,
      icDph: kept.icDph ?? party.icDph,
    };
  }
  return merged;
}
