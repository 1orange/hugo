# 06 — Invoice fields and derived roles

Type: AFK
Status: ready-for-agent
User stories: 14, 22, 27, 28

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The fields panel becomes able to hold an invoice, and the app learns which party is her client —
before any model exists. After this slice she can type an invoice completely by hand, and that is
enough for the export in slices 07 and 08.

End to end: a new `kind: "extracted"` payload (ADR 0017) with `parties[]` (name, IČO, DIČ, IČ DPH
or VAT ID — without roles), document number, variabilný symbol, issue date, DUZP, due date,
currency, total, a VAT summary per rate, and `docTypeHint`. Her confirmed payload gains the same
fields. The fields panel shows them for any document that is not an eKasa receipt, and an eKasa
payload maps into the same panel, its receipt date filling both issue date and DUZP.

**Roles are derived when the document is displayed, never stored** (ADR 0018): the party whose IČO
matches the company profile is her client — the customer in `02`, the supplier in `01` — and when a
VAT ID is printed its `SK` or `CZ` prefix must agree, which separates an SK and a CZ company that
share an IČO. Neither party matching is flagged; no profile leaves roles empty and flagged. A
profile saved later makes the roles appear with no re-extraction.

The existing arithmetic warning extends from one base and VAT to **every rate**. Fields can be in
one of three check states — correct, flagged, empty — and the panel shows flagged and empty fields
visibly differently; slice 12 fills the states from the model's checks.

## Acceptance criteria

- [ ] `kind: "extracted"` exists alongside `kind: "ekasa"`, with parse and serialize, and a corrupt row still renders as an empty payload
- [ ] Her confirmed payload holds VS, issue date, DUZP, due date, currency, total, per-rate VAT and both parties
- [ ] She can type a whole invoice by hand, including both parties, and it persists
- [ ] An eKasa payload shows in the same panel with its receipt date as issue date and DUZP
- [ ] `PartyRoles` derives supplier and customer from the profile and folder; neither matching is flagged; no profile leaves roles empty and flagged
- [ ] An IČO shared by an SK and a CZ company is disambiguated by the VAT-ID prefix
- [ ] Saving a profile after the fact shows correct roles on existing documents with no re-extraction
- [ ] Base plus VAT is checked against the total for every rate, with the message in Slovak
- [ ] Flagged and empty fields render differently from filled ones
- [ ] Her corrections survive any later rewrite of the extracted payload
- [ ] E2E: type an invoice with both parties on a company with a profile, reload, and see the correct supplier and customer

## Blocked by

- 04 — Company profile for Slovak companies
