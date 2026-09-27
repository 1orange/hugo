# PRD 0002 — Document extraction and the Omega export

Status: ready-for-agent
Owner: Filip
Primary user: single accountant (sole user of the system)
Continues: PRD 0001 (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)
Decisions: ADR 0016, ADR 0017, ADR 0018, ADR 0019

> PRD 0001 built the document dashboard: the sweep, the document model, the Slovak workbench, the
> chase list, and eKasa receipts read from the PDF text layer. This PRD covers what is still
> missing between a client uploading a file and that file's data sitting in Omega: reading every
> kind of document, and handing the result to Omega in one import. PRD 0001 slices 10, 11 and 15
> and the extraction part of slice 06 are replaced by this document; see *Relation to PRD 0001*.

---

## Current state, 2026-09-27

**Built:** one `documents` row per file in a processed folder, her two terminal decisions, the
three-pane workbench in Slovak (ADR 0015), the chase list, eKasa receipts parsed from the PDF text
layer with two arithmetic checks, and correcting or typing any field by hand with her values stored
separately from the extracted ones.

**Not built:** reading anything that is not a text-layer eBloček. Every invoice, every scan, every
photo and every Czech receipt reaches her as an empty form marked *Vyplň ručne*. There is no
company identity beyond a folder name, and no export at all.

Nothing is deployed and there is no production data.

---

## Problem Statement

She runs the books for a handful of companies, Slovak and Czech. Each month a client uploads proofs
into Drive — received and issued invoices, card and cash receipts, tickets, scans made with a phone
app, photos of receipts on a table — and she retypes every one of them into Omega: supplier, IČO,
IČ DPH, document number, variabilný symbol, dates, base and VAT per rate, total. Omega needs that
detail for the DPH return and the kontrolný výkaz. Then she does the actual accounting in Omega:
posting, accounts, VAT sections.

The retyping is where her hours go, and the app does not yet remove any of it for most documents:

1. **Invoices are not read at all.** 99 of the 100 issued and received invoices in the corpus carry
   a text layer, and none of that text is used.
2. **Scans and photos are not read at all.** A scanned eBloček and a photographed one carry exactly
   the same fiscal code as a PDF eBloček, and today both are blank forms.
3. **Czech receipts cannot be read the Slovak way.** Czech EET was abolished in 2023; they carry no
   fiscal code.
4. **Nothing reaches Omega.** Even a perfectly read document has to be typed into Omega again,
   because there is no import file.
5. **The app does not know who her client is**, so it cannot tell the supplier from the customer on
   an invoice where both parties' identifiers appear.

The data must also stay private. These are her clients' financial records under professional
confidentiality, and we are not prepared to vouch for any hosted AI provider with them.

## Solution

Read every document by the cheapest path that can be trusted, show her the result for
confirmation, and turn the month's confirmed documents into **one file she imports into Omega**.

- **eKasa receipts — PDF, scan or photo — are read through their fiscal UID.** The app finds the UID
  in the text layer, in a QR code, or in OCR text, or she types it, and Finančná správa's
  verification service returns the full receipt: supplier, date, items, VAT per rate. Verified on
  16 real receipts (ADR 0016).
- **Everything else is read by a local model**, with OCR in front of it for images. Both run as
  services on a machine we control, never on a third party's. Code checks the result — arithmetic
  per rate, identifiers that must occur in the text, formats — so every field ends up **correct,
  flagged or empty, never silently wrong** (ADR 0017).
- **Each company has a small profile**, set up once from the Slovak or Czech public register. Her
  client's own IČO decides which party on an invoice is the supplier (ADR 0018).
- **Each company-month produces one Omega import file**: partners, then invoices, then receipts. It
  carries data only. Accounts, posting and every other accounting code stay hers, in Omega
  (ADR 0019).

She still confirms every document, whichever path produced its data (ADR 0010). What changes is
that she confirms instead of types, and then imports instead of retyping.

**Only two things ever leave the box, and neither is a document:** an eKasa UID sent to the
authority that issued it, and a company name or IČO sent to a public register.

## Domain Glossary

New terms only; PRD 0001's glossary still applies.

| Term | Meaning |
| --- | --- |
| UID | The eKasa receipt identifier, `O-` or `V-` plus 32 hex characters; the key to the lookup |
| OPD lookup | Finančná správa's *Over doklad* endpoint, which returns a receipt for a UID |
| OKP variant | The offline eKasa QR form (OKP, register code, time, number, amount); lookup unverified |
| Lookup payload | An `ekasa` payload built from the OPD response, `source: "lookup"` |
| Text-layer payload | An `ekasa` payload from the existing parser, `source: "text-layer"`; now a fallback |
| Extracted payload (`extracted`) | The document-agnostic payload the local model produces |
| Party | One of the two businesses on a document, without a role until derived |
| Role | Supplier or customer, derived at display time from the company profile and folder |
| Company profile | Country, legal name, address, IČO, DIČ and IČ DPH of her client |
| Home currency | EUR for a Slovak company, CZK for a Czech one |
| Check state | Correct, flagged or empty — the only three states a field may end in |
| Grounding | The rule that an identifier must occur literally in the source text to be offered |
| `docTypeHint` | The model's guess: invoice, receipt, proforma, credit note, advance tax document, other |
| Sidecar | A service beside the app on the same or a tunnelled box: the model server, RapidOCR |
| Omega file | The one TXT import per company-month: `T04`, then `T01`, then `T00` |
| `T04` / `T01` / `T00` | Omega's partner list, invoicing, and accounting-document (EUD) data types |
| Export number | The stable, prefixed number the app gives a document for Omega |
| Held back | A confirmed document the writer cannot express correctly; left out, with the reason |
| VAT register | Omega's *evidencia DPH – Odpočítanie dane* PDF, a source of benchmark labels |

## User Stories

### eKasa receipts

1. As the accountant, I want a receipt's data read from the fiscal record, so that I confirm it
   instead of retyping it.
2. As the accountant, I want a scanned receipt with an eKasa QR code filled in, so that scans stop
   being blank forms.
3. As the accountant, I want a photographed receipt — JPEG or HEIC — filled in the same way, so that
   it does not matter how the client captured it.
4. As the accountant, I want to type or paste a UID for a receipt whose QR code is damaged, so that
   one field fills the whole document.
5. As the accountant, I want a mistyped UID rejected rather than accepted, so that I cannot attach
   another receipt's data by accident.
6. As the accountant, I want marketing and payment QR codes ignored, so that only the fiscal code is
   ever used.
7. As the accountant, I want to see whether a receipt's data came from the fiscal record or from the
   receipt's own text, so that I know what I am confirming.
8. As the accountant, I want the receipt's own text used when the fiscal service is unreachable or
   does not know the receipt yet, so that an outage never blocks me.
9. As the accountant, I want base and VAT per rate and the line items for a receipt, so that
   multi-rate receipts are right without me doing the arithmetic.

### Reading everything else

10. As the accountant, I want the fields of a received invoice pre-filled from the PDF, so that I
    stop retyping supplier invoices.
11. As the accountant, I want the fields of an issued invoice pre-filled too, so that revenue is
    covered as well as costs.
12. As the accountant, I want a scanned or photographed invoice read, so that the rare scan is not a
    manual job.
13. As the accountant, I want a receipt with no eKasa code — a parking machine, a Czech shop, a
    foreign one — read, so that those are not manual jobs either.
14. As the accountant, I want the document number, variabilný symbol, issue date, DUZP, due date,
    currency, total, and base and VAT per rate, so that I have every field Omega needs.
15. As the accountant, I want a field the app is unsure of either flagged or left empty, never
    filled with a plausible guess, so that I can trust what is pre-filled.
16. As the accountant, I want base plus VAT checked against the total for every rate, so that a
    misread digit is caught before it reaches my books.
17. As the accountant, I want an IČO, IČ DPH, VS or IBAN offered only if it is printed on the
    document, so that the app never invents an identifier.
18. As the accountant, I want a document with two VAT rates, such as 5% and 23%, to show both, so
    that hotel and mixed invoices are right.
19. As the accountant, I want a "looks like a proforma" hint, so that I notice it before it can be
    double-booked, while the decision stays mine.
20. As the accountant, I want credit notes accepted with negative amounts, so that they are not
    flagged as errors.
21. As the accountant, I want extraction to run in the background with its progress visible, so
    that opening a month stays fast.
22. As the accountant, I want my corrections to survive a later re-extraction, so that improving the
    reader never undoes my work.
23. As the accountant, I want my clients' documents read without being sent to any third-party
    service, so that I keep my duty of confidentiality.

### Company profile

24. As the accountant, I want to set up each company once by picking it from the public register,
    found by its folder name, so that I do not type its details.
25. As the accountant, I want Slovak and Czech companies both supported, so that all my clients fit.
26. As the accountant, I want to type the IČ DPH myself, so that a VAT group's number is never
    guessed wrong.
27. As the accountant, I want the supplier and customer on an invoice decided from my client's own
    identity, so that they are never swapped.
28. As the accountant, I want an invoice where neither party is my client flagged, so that a
    misfiled document stands out.
29. As the accountant, I want the dashboard to show which companies have no profile yet, so that I
    know what to set up.
30. As the accountant, I want "foreign currency" to mean foreign to that company, so that CZK is
    normal for a Czech client.
31. As the accountant, I want to edit a profile later, so that a name change or dissolution can be
    recorded.

### Export to Omega

32. As the accountant, I want one import file per company and month, so that one import brings the
    whole month into Omega.
33. As the accountant, I want only documents I confirmed in the file, so that nothing I have not
    approved reaches my books.
34. As the accountant, I want the partners included in the file, so that the import does not fail on
    a supplier Omega does not know yet.
35. As the accountant, I want invoices and receipts placed where Omega expects them according to
    what the document is, not which folder it was in, so that a taxi invoice filed with the
    receipts still arrives as an invoice.
36. As the accountant, I want to change that placement for a document, so that I can correct it.
37. As the accountant, I want no accounts or other internal codes in the file, so that I do the
    accounting in Omega as I always have.
38. As the accountant, I want to regenerate a month's file and import it again without duplicates,
    so that late arrivals can be added safely.
39. As the accountant, I want the supplier's own document number carried in the file, so that the
    kontrolný výkaz has it.
40. As the accountant, I want a foreign-currency document to keep its currency and amount, with no
    exchange rate invented, so that Omega applies the correct rate.
41. As the accountant, I want my own firm's Omega-issued invoices kept out, by marking them not
    relevant, so that they are not booked twice.
42. As the accountant, I want a confirmed document the file cannot express correctly held back with
    the reason, so that nothing is imported wrong.

### Measuring the reader

43. As the developer, I want a scoring harness that compares extraction with what she actually
    booked in Omega, so that the choice of model is measured rather than guessed.
44. As the developer, I want the model server and OCR in one compose file that runs on my laptop
    and on the deployment node, so that iterating and deploying are the same setup.
45. As the developer, I want timing measured CPU-only, so that the laptop does not flatter a model
    the deployment node cannot run.

## Implementation Decisions

| ADR | Decision |
| --- | --- |
| 0004 | SQLite on one box; extracted data as JSON payloads, confirmed values separate |
| 0008 | Largely superseded by 0016 and 0017; its text-layer findings still hold for the fallback parser |
| 0010 | Her decision is authoritative and gates the export |
| 0012 | Append-only event log |
| 0013 | Documents are primary; amended by 0019 — cash versus card no longer decides anything |
| 0014 | Partly superseded by 0019; encoding, `.LOG` and non-transactional import still hold |
| 0016 | eKasa receipts through the UID and the OPD lookup; text-layer parser as fallback |
| 0017 | Local model and RapidOCR as sidecars; one checked `extracted` payload; the adoption bar |
| 0018 | Company profile from RPO, RÚZ and ARES; roles derived from the company's IČO |
| 0019 | One data-only Omega file per company-month: `T04`, `T01`, `T00` |

### The pipeline, per document

1. **Find a UID**: text layer, then QR codes in page images or the photo. Found → OPD lookup →
   `ekasa` payload, `source: "lookup"`. Lookup failed → the text-layer parser if there is text.
2. **No UID and a text layer** → the model → checks → `extracted` payload.
3. **No UID and no text layer** → OCR → search the OCR text for a UID (found → step 1's lookup) →
   otherwise the model → checks → `extracted` payload.
4. **Nothing produced a payload** → an empty payload with the reason, which she fills in.

Documents already attempted are not re-attempted automatically. A UID typed into the box, or an
explicit re-read, starts the pipeline again for that document.

### Module boundaries

Risky logic is pure and testable without the network, a model or Drive. I/O sits behind ports with
hand-written fakes, as in PRD 0001.

**Pure modules, new or extended**

- `EkasaUid` — finds a UID in text lines, a QR payload or OCR text by search, not whole-string
  match; recognises the OKP variant; rejects everything else. Extends `ekasa-identifiers.ts`.
- `EkasaLookupMapping` — OPD response to `ekasa` payload: base and VAT per rate computed from items
  in minor units, rates normalised, discounts included; rejects a response whose `receiptId`
  differs or whose items do not sum to the total.
- `ExtractedPayload` — the `kind: "extracted"` type with `parse` and `serialize`, alongside the
  existing `ekasa` kind in `document-payload.ts`.
- `ExtractionChecks` — arithmetic per rate, grounding, IČO checksum, IČ DPH and CZ VAT ID formats,
  IBAN mod-97, date plausibility against the document's month, rates valid for the issuer's
  country. Output is a check state per field.
- `PartyRoles` — parties, company profile and folder in; supplier and customer out, or a flag.
- `OcrLines` — OCR boxes to lines grouped by y-coordinate with `|` between cells, matching
  `pdf-access.ts`.
- `OmegaFile` — confirmed documents, partners and settings in; Windows-1250 bytes out. Sections,
  mandatory fields, VAT slots, dot decimals, length rules, held-back documents with reasons.
- `ExportNumbering` — assigns a stable prefixed number to a document the first time it is written,
  and never changes it.
- `BenchmarkScoring` — a payload against a label, with the scoring rules of ADR 0017: `B1`
  documents on base only, receipt dates not scored.
- `DocumentFields` — the existing merge of extracted and confirmed values gains VS, DUZP, due date,
  parties and derived roles; `nonEurCurrency` becomes "not the company's home currency".

**Ports and adapters, new or extended**

- `EkasaLookup` — HTTP to the OPD endpoint: honest User-Agent, one request at a time, response
  stored on the document.
- `QrReader` — `zxing-wasm`. No native dependency.
- `PdfAccess` — gains page-image extraction through pdfjs's operator list, with no canvas.
- `Extractor` — OpenAI-compatible HTTP to `llama.cpp` server or Ollama, JSON-schema-constrained,
  configured by URL and model name.
- `Ocr` — HTTP to RapidOCR.
- `CompanyRegister` — RPO and RÚZ for Slovak entities, ARES for Czech ones; name search and lookup
  by IČO.
- Label import — a script, not runtime code, that turns an Omega `T01` export and a VAT-register PDF
  into benchmark fixtures.

### Schema

- **Company profile** on `companies` or in a `company_profiles` table: country, legal name,
  address, IČO, DIČ, IČ DPH, register source, when she saved it.
- **Partners** keyed by country and IČO, filled from the registers and the eKasa `organization`,
  used for `T04`.
- **`documents`** gains the export number and an optional export-section override. The existing
  `exported_at` and `export_batch` are reused.
- **Settings** gain the export defaults: evidence and series codes per section and the receipt
  document type. The model and OCR endpoints are environment configuration, not settings.
- Payloads gain `source`. The OPD response is stored raw inside the lookup payload.

### Events

New event types for the append-only log (ADR 0012): extraction completed or failed, with its
source; company profile saved; export generated, with the documents included and held back.

### Interaction details

- **Fields panel:** VS, DUZP, due date and both parties with their derived roles; a source badge
  (fiscal record, receipt text, model, OCR plus model); flagged and empty fields visibly different
  from filled ones; the proforma hint; the UID box on receipts; the export-section override.
- **Company profile:** set up from the chase list where a company shows "profile missing" — search
  results with IČO, address and status, pick one, then type the IČ DPH.
- **Export:** a download on the month screen. Before downloading it lists what is included and what
  is held back, and why.

---

## Testing Decisions

TDD for every pure module, `node:test` and `node:assert` only, hand-written fakes next to their
ports — the conventions PRD 0001 established. Tests assert behaviour, not structure.

### Unit tests

- `EkasaUid` — a UID found inside `V-…OKP: …`; the marketing QR on the Slovnaft receipt ignored; a
  PAY by square payload ignored; a UID found in OCR-style text with separators.
- `EkasaLookupMapping` — per-rate base and VAT from items equal the printed recapitulation of the
  seven text-layer receipts; `23` and `23.0` are one rate; a discount item reduces the total; a
  mismatched `receiptId` or item sum is rejected.
- `ExtractionChecks` — per-rate arithmetic passes and fails; an IČO not in the text is dropped; a
  bad IČO checksum, IČ DPH or IBAN is flagged; a Czech rate on a Slovak issuer is flagged; a credit
  note's negative amounts pass.
- `PartyRoles` — supplier in `02`, customer in `01`; neither party matching is flagged; no profile
  leaves roles empty and flagged; the same IČO in SK and CZ is separated by the VAT-ID prefix.
- `OcrLines` — boxes on one baseline join into one line in x order; the output shape matches
  `pdf-access.ts`.
- `OmegaFile` — Windows-1250, TAB, CRLF; section order `T04`, `T01`, `T00`; received invoice as
  type 14; VAT in the right slots; one item per rate; no account fields written; dot decimals;
  free text shortened and an overlong identifier held back; **a golden-file comparison of the six
  `spring` May issued invoices against her `T01` export's data columns.**
- `ExportNumbering` — a document keeps its number across regenerations; numbers never collide
  within a company.
- `BenchmarkScoring` — a `B1` document is scored on base only; a receipt date mismatch does not
  count.

### Integration tests

Real SQLite in a temporary file, real repositories, fake adapters.

- A scanned receipt: page image → fake QR reader → fake lookup → payload with `source: "lookup"`.
- The lookup fails → the text-layer parser runs → `source: "text-layer"`.
- A text-layer invoice → stub `Extractor` → checks → `extracted` payload with check states.
- An image with no UID → fake OCR → stub `Extractor`; an image whose OCR text holds a UID → the
  lookup.
- A company profile saved after extraction → roles appear with no re-extraction.
- A month with confirmed, dismissed and held-back documents → one file; regenerating it produces
  the same export numbers.

### End-to-end tests

Playwright with the fake Drive, fake lookup, fake register and stub `Extractor`.

- Type a UID into the box on a blank receipt and see it fill.
- Set up a company profile from search results and see an invoice's roles appear.
- Confirm documents and download the month's file; the held-back list shows its reason.

### The benchmark

Separate from the test suite and run on demand. Fixtures come from Omega's own outputs: 17
documents for `spring` May to start — six issued invoices from her `T01` export and eleven received
documents from the VAT register. It reports per-field exact match, the check-state distribution,
the ADR 0017 bar and median time per document, in Docker, CPU-only.

**Fixtures built from real documents stay private.** They live under a path excluded by
`.gitignore`, as does anything recorded from the OPD lookup or the registers for real receipts.
Committed unit tests use synthetic data. The one exception already in the working tree,
`docs/reference/omega/eport OF .txt`, holds real client names and her firm's IBAN and should get
the same treatment before the repository gains a remote.

---

## Open Questions

1. **The first real import.** Deferred by her choice. Seven unknowns are listed in ADR 0019: a
   received invoice in `T01` with no accounts or series, prefixed numbers, `T00` with empty MD and
   DAL, new partners behind a `T04` section, a repeated import, dot decimals, empty exchange rates.
   Plus whether Omega 29.20 accepts the 28.00 spec for `T00`.
2. **If `T00` rejects empty accounts.** A single constant account pair she nominates as a format
   filler, or receipts left out of the file. Neither involves the app choosing accounts. Decided
   when question 1 is answered.
3. **Czech companies in Omega.** Their books are in CZK, and the spec's VAT slots are Slovak rates.
   How Omega holds a Czech company — and whether the same file format applies — is unknown.
4. **The OKP (offline) QR variant.** No receipt in the corpus carries one; whether the lookup
   answers for it is untested.
5. **Which model, and which node.** Decided by the benchmark against the ADR 0017 bar, then the
   N100 or an Ampere node on the k3s cluster.
6. **The five unlabelled `spring` May documents.** Labelled when she exports *Doklady EUD* for that
   month; the benchmark starts without them.
7. **Foreign partners in `T04`.** Omega matches partners on name, IČO and IČO order number
   together. How it treats a partner with no IČO, such as Kaspersky in the Netherlands, is unknown.
8. **The default receipt document type.** She books card receipts as `IDk`; every eKasa receipt in
   the corpus sits in the card folder. The default is `IDk` unless she says otherwise.
9. **Private fixtures.** Confirm that `.gitignore` is the right mechanism, rather than a separate
   private repository.

## Out of Scope

- **Accounting.** Accounts, posting, predkontácie, KV DPH sections, cost centres, evidence
  decisions. The app parses and hands over; she does the accounting in Omega.
- **Cash versus card.** Removed from the app (ADR 0019).
- **Line items from the model.** Only where they are free: the eKasa lookup and the text-layer
  parser.
- **PAY by square**, and every QR code that is not an eKasa code.
- **Hosted models** and any other path that sends a document off machines we control.
- **Fine-tuning.**
- **Automating Omega** or the test import. She imports the file.
- **Bank statements.** Still presence-only (ADR 0013).
- **Auto-dismissing proformas.** A hint only; the decision stays hers.
- **An accuracy monitor in production** comparing extraction with her monthly VAT register. The
  same scoring makes it possible later; it is not built here.

## Further Notes

### What the corpus showed, 2026-09-27

- **16 of 16 real UIDs resolve** at the OPD endpoint, and the seven text-layer receipts match the
  existing parser field for field.
- **9 of the 12 image-only and photographed documents** in `04`, `05` and `02` resolve through a
  UID: 8 by QR decoding, one by its printed UID where the QR was damaged. Two are parking-machine
  receipts with no eKasa code; one is an invoice with a PAY by square code.
- **The six `spring` May issued invoices match her `T01` export** on every field compared.
- **The May VAT register labels 11 of 16 received-side documents** for `spring`, and shows her codes
  — `DF`, `FDD`, `IDk`, `zDF` — and that the Bolt taxi invoice filed in `05` is booked as an
  invoice.
- **The Grand hotel document is the first real multi-rate document**, 5% and 23%, and it is a scan.

### Relation to PRD 0001

- **Slice 06** (eKasa text layer) stays built; its parser becomes the fallback of ADR 0016.
- **Slice 10** (label invoices) is replaced by labels taken from Omega's own outputs.
- **Slice 11** (invoice extraction) is replaced by this PRD's extraction slices.
- **Slice 14** (settings and company profiles) keeps its settings half; the profile half is here.
- **Slice 15** (Omega TXT export) is replaced by the one-file export of ADR 0019.
- **Slice 07** (obtain an Omega export sample) is satisfied for `T01` by `eport OF .txt`; a *Doklady
  EUD* export is still wanted for `T00`.
- Open questions 1, 7, 10, 11, 12, 13 and 14 of PRD 0001 are answered or carried forward here.
