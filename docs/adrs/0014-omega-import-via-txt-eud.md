# ADR 0014 — Omega import via the TXT `T00` (EUD) format, not ISDOC

Date: 2026-08-30
Status: Accepted

## Context

With pairing moved to Omega (ADR 0013), producing an artifact Omega accepts *is* the app's finish
line. PRD open question 1 assumed ISDOC for received invoices plus a TXT format for everything else,
citing `ImportExport_20_60.xls` at kros.sk/66711.

That is now researched against primary sources, and three of the assumptions were wrong.

**The spec reference was dead.** The URL 404s. The specification was split in 2025 when Slovakia's
VAT rates changed to 23/19/5%: `ImportExport_28_00_2025.xls` covers documents from 2025 onward,
`Import_24_60.xls` covers up to 2024. Both download without login from `ftpkros.sk`. The current file
is for Omega **28.00** and was last saved November 2024, while the shipping program is **29.20**
(April 2026) — the published spec trails the product by roughly six releases.

**`T08` (Úhrady) cannot be imported.** Its sheet is marked *"Platí len pre Export"*. Had the
payment-centric model survived, exporting payments to Omega would have been impossible; the pivot in
ADR 0013 avoided a dead end rather than merely simplifying one.

**There is no usable API.** Omega's Konektor API accepts only *sent* invoices and *received orders*,
so received invoices and receipts — the entire corpus here — are out, and it needs a paid support
package. The `api-economy.kros.sk` OpenAPI belongs to different products (KROS Fakturácia / Firma).
"KROS Cloud" is remote-desktop hosting of the same desktop application, not a cloud API. Omega
remains a desktop program over MS Access or MS SQL, with no documented COM or ODBC interface.

One line in the spec's General Description sheet shapes everything below: *"Export and import of
Omega use the same file format. You can obtain a sample import file by exporting the same data from
Omega."* The authoritative reference for our writer is therefore a file from her own installation,
not the spreadsheet.

## Decision

Generate the **TXT `T00` (EUD)** format. One `R00` line declaring the data type, then `R01` document
headers each followed by one or more `R02` items.

Format constraints are from the spec and are not negotiable: **Windows-1250** encoding (not UTF-8),
**TAB** (ASCII 9) separators, **CRLF** line endings, dates as `DD.MM.RRRR`. Mandatory fields are
encoded in the spreadsheet as *cell background colour* — yellow is mandatory, orange is conditionally
mandatory — rather than as text.

The cash-versus-card distinction that ADR 0013 derives from the folder maps directly onto Omega
document type codes in `R01`, chosen in the file rather than in the import dialogue: `160` for a cash
document (pokladničný doklad), `180` for an internal document, `130` for a received invoice, with
`330`/`360` as the foreign-currency twins. KROS's own stated convention for card purchases is the
internal-document circuit, not the bank circuit, precisely so the accountant can pair them against
the statement herself — which is exactly the workflow here.

**ISDOC is not the primary route.** It reaches only the three received-invoice ledgers, cannot
express a cash receipt at all, requires a fabricated `UUID`, mandatory free text in
`ElectronicPossibilityAgreementReference`, `CurrRate` and `RefCurrRate` even on domestic invoices,
and the version Omega accepts is documented nowhere by KROS. It is the narrower route for more work.
Where a supplier already sends an ISDOC file, **pass the original through untouched** rather than
regenerating it.

## Consequences

- **Import is not transactional.** Each record succeeds or fails independently, so a partial import
  is a normal outcome rather than an error case.
- **The success dialogue is not evidence.** KROS documents that its completion message does not mean
  the data imported. A `.LOG` file is written beside the input, referencing input line numbers. Our
  export is therefore not "done" when the file is written, and the log is the only honest confirmation.
  This is the same reasoning as ADR 0006's write-ahead intent: the artifact is not the outcome.
- **Duplicate detection is a client-side setting**, under *Firma – Nastavenia – Všeobecné nastavenia
  – Prechod/Import/Eshop*. Re-import normally refuses with "such a document already exists". A
  duplicate header silently orphans its items, which is a corruption mode worth testing against.
- **Partners are not auto-created.** An unknown partner is not added, so a `T04` partner block may
  have to precede the documents.
- **String lengths must respect Omega's column sizes** or the row fails.
- **`R02` requires double-entry accounts** — MD and DAL, synthetic and analytic. This is unresolved
  and is the largest open question in the export: either the app carries a posting map (which means
  encoding accounting judgement it has so far refused to encode, per ADR 0010) or it emits documents
  for her to post. See PRD open question 1.
- Evidence codes and number-series codes must already exist in her Omega, so they are configuration
  rather than constants.
- Foreign currency is expressible: the format carries currency, unit quantity, the ECB rate and the
  bank rate, plus totals in both currencies. There is **no rate-date field** — Omega derives it from
  DUÚP — and where both rates are supplied the bank rate wins. This partly answers PRD open question
  10, though the legal requirement (the ECB rate from the day before the accounting event) still
  argues for letting Omega fill rates from its own kurzový lístok rather than the app guessing.

## Unknowns, deliberately not guessed

- **The decimal separator for amounts.** Independently verified as absent: the spreadsheet contains
  no literal decimal example anywhere in 16 sheets, and comma is documented as a *date* divider,
  which makes inference actively dangerous. A wrong separator is the most likely cause of a silently
  wrong amount reaching her books.
- Whether Omega 29.20 accepts a file built to the 28.00 spec unchanged.
- Whether the `>>` optional-field boundary is mandatory as a row, where the colour coding and the
  `>>` legend disagree.

All three are settled by **one export from her own Omega** — *Firma – Export – Export do textového
súboru*, data type "Doklady EUD" — after she enters one cash receipt, one card purchase and one
foreign-currency receipt by hand. Because export and import share the format, that file is the
specification. This is the single highest-value thing to obtain before writing the exporter.

## Alternatives considered

- **ISDOC as the primary route.** Rejected above. Retained for pass-through only.
- **Konektor API.** Wrong document types entirely, and paid.
- **Writing to Omega's Access/SQL database directly.** Undocumented, unsupported, and the failure
  mode is a corrupted client ledger.
- **KROS Digitálna kancelária.** KROS sells this exact workflow at €25.90 per company per month —
  client upload, eKasa extraction, one click into Omega with posting applied. It has no third-party
  ingest API, so it cannot be a channel for this app; it is a competitor. At 10–15 companies it costs
  €3,100–4,700 a year against a small VPS, which is why building remains reasonable, but the overlap
  should be a deliberate choice rather than an accident.
