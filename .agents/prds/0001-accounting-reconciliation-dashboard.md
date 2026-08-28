# PRD 0001 — Accounting Reconciliation Dashboard

Status: ready-for-agent
Owner: Filip
Primary user: single accountant (sole user of the system)

---

## Problem Statement

She is an accountant running the books for a handful of companies. Every client has a Google
Drive folder she owns and has shared with them; the client uploads documents into it and she
processes them once a month.

Today the work looks like this. She opens the client's month folder in Drive, opens the bank
statement PDF, and goes line by line through the payments. For each payment she hunts through
`02 Prijaté faktúry`, `04 Bločky_hotovosť` and `05 Bločky_firemná karta` for the document that
proves it. Then she retypes every invoice into Omega by hand — supplier, IČO, IČ DPH, invoice
number, variabilný symbol, tax base per rate, VAT, delivery date — because Omega needs that
detail to produce the daňové priznanie DPH and the kontrolný výkaz DPH.

Four specific pains:

1. **No memory of what's done.** Nothing records which documents she has already processed, so
   picking the work back up after an interruption means re-deriving it from scratch. She cannot
   answer "how much is left on this client?" without opening Drive and counting.
2. **Retyping.** The invoice data is already in the PDF. She types it a second time into Omega.
   This is where her hours go.
3. **Late arrivals land in closed months.** A client uploads a May invoice in July, after May is
   filed. It sits in the May folder where it will never be seen again, and it belongs in the open
   month because the VAT deduction gets claimed there.
4. **Pairing is manual and invisible.** Matching each bank payment to its proof is done by eye,
   and a payment with no proof — which cannot legally be used in the accounting — is only caught
   if she happens to notice.

## Solution

A single-user web dashboard, read-mostly over her existing Drive structure, that treats the
**bank statement as the spine of the month**.

Every payment line from the statement becomes a `Payment`. Every cash bloček is also a `Payment`
(one that arrives already carrying its own proof). Documents in the client's folders become
`Proof` records that attach to payments. A payment with a proof is eligible for the accounting; a
payment without one is a warning she resolves. She ticks off each payment as she confirms it, and
that tick is both her progress marker and the gate that lets the payment into the Omega export.

The app never becomes the record of truth for documents — Drive stays the 10-year legal archive.
The app is the index, the reconciliation surface, and the memory of what has been done.

Concretely it gives her:

- One row per company showing where it sits in the monthly cycle and how much is unticked.
- A reconciliation screen per company-month: payments down the left, unpaired proofs on the
  right, suggested matches inline, PDF preview, one tick per payment.
- Invoice fields extracted from the PDF text so she confirms rather than retypes.
- Receipt amounts and timestamps decoded from the eKasa QR code — exact, not guessed.
- A late-arrivals log with a proposed move into the open month, which she confirms in one click
  and can undo.
- An export of the ticked payments for import into Omega.
- Historical months, read-only, browsable the same way.

## Domain Glossary

Terms used throughout this document and expected in the code.

| Term | Meaning |
| --- | --- |
| Company | One client of hers; one top-level Drive folder |
| Month folder | `YYYY_MM` directly under the company folder |
| `01 Vystavené faktúry` | Issued invoices (client's own sales) |
| `02 Prijaté faktúry` | Received invoices (supplier invoices) |
| `03 Bankové výpisy` | Bank statements (encrypted PDFs) |
| `04 Bločky_hotovosť` | Cash receipts, paid from the till |
| `05 Bločky_firemná karta` | Company card receipts, appear on the statement |
| `06 Iné doklady` | Other documents |
| `07 Mzdy` | Payroll |
| Payment | A bank statement line, or a cash bloček |
| Proof | A document that substantiates a payment |
| Pairing | The link between a payment and a proof (many-to-many) |
| VS | Variabilný symbol; on SK transfers usually equals the invoice number |
| IČ DPH | VAT identification number |
| eKasa / eBloček | The Slovak fiscal receipt system and its PDF receipt |
| OKP / UID | eKasa verification code / unique receipt identifier |
| Omega | KROS Omega, her double-entry accounting software |
| ISDOC | XML invoice interchange format that Omega imports |
| Open month | The month currently being processed for a company |
| Closed month | A month she has explicitly closed after filing DPH |

## User Stories

### Setup and companies

1. As the accountant, I want to sign in with my Google account, so that nobody else can reach my clients' data.
2. As the accountant, I want the app to discover all company folders under one shared parent, so that I never register clients by hand.
3. As the accountant, I want to see a company list with the open month and how many payments are still unticked, so that I know where to start work.
4. As the accountant, I want to store a bank statement password per company, so that the app can open statements without asking me every time.
5. As the accountant, I want to be asked for a new statement password only when decryption actually fails, so that a rotated bank password is a one-time interruption rather than a recurring prompt.
6. As the accountant, I want to override the folder template for a specific company, so that a client with no employees does not get an empty `07 Mzdy` every month.
7. As the accountant, I want to mark a company inactive, so that a former client stops appearing in my work list without deleting the history.

### Global settings

8. As the accountant, I want to edit the canonical list of folder names, so that changing my filing convention does not require a code change.
9. As the accountant, I want to choose which folders are movable when a document arrives late, so that the app never moves a bank statement or payroll document across periods.
10. As the accountant, I want to see the folder template that new months will be created from, so that I can confirm it before it is applied to every client.

### Drive synchronisation

11. As the accountant, I want the app to notice new uploads without me pressing anything, so that the work list is current when I open it.
12. As the accountant, I want the app to catch up on everything that changed while I was away, so that a missed notification never means a lost document.
13. As the accountant, I want a manual Refresh, so that I can force a re-read when I have just uploaded something myself.
14. As the accountant, I want documents identified by their Drive file ID rather than their path, so that renaming or moving a file does not lose the work I have already done on it.
15. As the accountant, I want to see when the app last successfully read Drive, so that I can tell whether I am looking at stale information.

### Folder structure and repair

16. As the accountant, I want next month's folders created for me when I close a month, so that I never build the structure by hand.
17. As the accountant, I want the open month's folders created automatically if they are missing, so that a client always has somewhere to upload.
18. As the accountant, I want folders whose names do not match the canonical list flagged as unrecognised, so that a typo does not silently hide documents from me.
19. As the accountant, I want to fix a misnamed folder with one click, so that `04 Bločky_hotorvosť` becomes canonical without me editing Drive.
20. As the accountant, I want to be told that renaming a folder will not break my clients' links, so that I am comfortable clicking the repair button.

### Month lifecycle

21. As the accountant, I want to explicitly close a month per company, so that the app knows which documents arrived late rather than guessing from my filing habits.
22. As the accountant, I want to reopen a month I closed by mistake, so that a misclick is not permanent.
23. As the accountant, I want to browse any historical month read-only, so that I can answer a question about last February without risk of changing anything.
24. As the accountant, I want the VAT output PDFs at the month root left completely alone, so that the reports Omega produced are never touched.

### Bank statements

25. As the accountant, I want the statement PDF opened with the stored password automatically, so that I do not decrypt it by hand.
26. As the accountant, I want every statement line turned into a payment with date, amount, counterparty, IBAN and variabilný symbol, so that I can reconcile without reading the PDF.
27. As the accountant, I want the app to verify that opening balance plus movements equals closing balance, so that a silently broken parser cannot poison a whole month.
28. As the accountant, I want a statement that fails that check flagged loudly and excluded from the work list, so that I never reconcile against numbers I cannot trust.
29. As the accountant, I want to be told which bank a statement came from and whether it is supported, so that an unsupported bank is an obvious gap rather than a mystery.
30. As the accountant, I want a second statement in the same month handled correctly, so that a client with a mid-month export does not produce duplicate payments.

### Receipts (eKasa)

31. As the accountant, I want the eKasa QR code read from an eBloček, so that the amount and time come from the fiscal code rather than from guessing at text.
32. As the accountant, I want a cash bloček treated as a payment in its own right, so that a till purchase reaches Omega even though no bank line will ever match it.
33. As the accountant, I want a card bloček matched against the statement, so that I can confirm the card transaction has its proof.
34. As the accountant, I want a receipt with no readable QR flagged for manual entry, so that it is queued rather than silently skipped.

### Invoice extraction

35. As the accountant, I want the fields of a received invoice read out of the PDF, so that I confirm them instead of retyping them into Omega.
36. As the accountant, I want the extracted supplier, IČO, IČ DPH, invoice number, variabilný symbol, issue date, delivery date, tax base per rate, VAT per rate, total and currency shown next to the PDF, so that I can check them at a glance.
37. As the accountant, I want the app to verify that base plus VAT equals total, so that a misread digit is caught before it reaches my books.
38. As the accountant, I want to correct any extracted field, so that my correction rather than the machine's guess is what gets exported.
39. As the accountant, I want my correction remembered, so that re-reading the document does not overwrite what I fixed.
40. As the accountant, I want a foreign-currency invoice to keep its currency and amount, so that a CZK or USD document is not silently treated as euro.
41. As the accountant, I want extraction to run without me waiting for it, so that opening a month is fast even when many documents are new.

### Pairing

42. As the accountant, I want suggested matches ranked for each payment, so that the obvious ones take one click.
43. As the accountant, I want matching to prefer variabilný symbol, then amount plus IBAN, then amount plus date and name, so that suggestions are explainable rather than magic.
44. As the accountant, I want to pair one payment with several proofs, so that a single transfer settling three supplier invoices is recorded correctly.
45. As the accountant, I want to pair one proof with several payments, so that an invoice paid in installments is recorded correctly.
46. As the accountant, I want to unpair something, so that a wrong link is reversible.
47. As the accountant, I want payments with no proof listed as warnings, so that I can decide case by case whether they belong in the accounting.
48. As the accountant, I want proofs with no payment listed as warnings, so that a document nobody paid for does not disappear.
49. As the accountant, I want to preview a proof PDF next to the payment, so that I can confirm the match without leaving the screen.

### Progress and completion

50. As the accountant, I want to tick each payment as done, so that my own judgment rather than the system's inference decides what is finished.
51. As the accountant, I want the derived status shown as a hint alongside my tick, so that I can see what the app thinks without it overruling me.
52. As the accountant, I want the remaining count per company to reflect my ticks, so that "what's left" means what I have not personally confirmed.
53. As the accountant, I want to leave a note on a payment or proof, so that I can record why something is unusual before I forget.
54. As the accountant, I want to see at a glance which stage of the monthly cycle a company is at, so that I can plan the order I work in.

### Late arrivals

55. As the accountant, I want every document that arrives in a closed month logged, so that nothing that landed late is lost.
56. As the accountant, I want each late arrival to carry a status of pending, moved, ignored or resolved, so that I can clear the list deliberately.
57. As the accountant, I want a proposed move into the open month for late arrivals in movable folders, so that the VAT deduction lands in the period where I will claim it.
58. As the accountant, I want to confirm all proposed moves for a company in one click, so that clearing the list is fast.
59. As the accountant, I want a late arrival in a non-movable folder shown as a warning instead of a move, so that a late bank statement or payroll document is never relocated.
60. As the accountant, I want to ignore a late arrival, so that a duplicate upload does not stay on my list forever.
61. As the accountant, I want to undo a move, so that a mistake in someone else's Drive is recoverable.
62. As the accountant, I want the destination subfolder created if it does not exist, so that a move never fails for a missing folder.

### Export to Omega

63. As the accountant, I want only ticked payments included in the export, so that nothing reaches my books without my approval.
64. As the accountant, I want a proforma or duplicate simply left unticked, so that excluding it needs no extra concept to learn.
65. As the accountant, I want one export file per company, so that I import into the right Omega company database.
66. As the accountant, I want received invoices exported as ISDOC, so that Omega fills in partner, items and VAT itself.
67. As the accountant, I want to be warned when I export something that was exported before, so that I do not double-book it in Omega.
68. As the accountant, I want the export to record what it contained and when, so that I can reconstruct what I imported if Omega and the dashboard disagree.
69. As the accountant, I want to see what the export will contain before I download it, so that I can spot a mistake before it reaches Omega.

### Audit and history

70. As the accountant, I want a per-company activity log of everything the app and I did, so that I can explain any change to a client.
71. As the accountant, I want every Drive write recorded with enough detail to reverse it, so that undo is trustworthy rather than best-effort.
72. As the accountant, I want to see when a document first appeared, so that I can tell a client when they actually uploaded it.

---

## Implementation Decisions

Decisions with meaningful alternatives are recorded as ADRs in `docs/adrs/`. This section covers
module boundaries, interfaces and schema.

| ADR | Decision |
| --- | --- |
| 0001 | Drive access via a service account, not OAuth |
| 0002 | Payment-centric domain model, many-to-many pairing |
| 0003 | Sweep-based sync, webhook as trigger, no scheduler |
| 0004 | SQLite on a single EU VPS |
| 0005 | Explicit month close as the lifecycle anchor |
| 0006 | Drive mutations proposed, recorded and reversible |
| 0007 | Canonical folder names with a one-time rename repair |
| 0008 | No OCR engine — text layer plus eKasa QR |
| 0009 | Per-bank statement parsers with a reconciliation assert |
| 0010 | Her confirmation is authoritative and gates the export |
| 0011 | App auth via Auth.js Google, separate from Drive credentials |
| 0012 | Append-only domain event log |

### Platform

- Next.js App Router, TypeScript, Tailwind, shadcn/ui.
- Single small EU VPS, Caddy in front for TLS, Next running as a systemd service.
- SQLite via `better-sqlite3` with Drizzle. Synchronous access is acceptable and desirable at
  single-user scale. See ADR 0004.
- No scheduler. See ADR 0003.
- Node only — no Python sidecar, no OCR engine. See ADR 0008.

### Module boundaries

Risky logic is pure and testable without Drive, a bank, or a model. I/O sits in thin adapters
behind ports.

**Pure modules**

- `FolderTaxonomy` — month folder naming (`YYYY_MM`), canonical subfolder list, and
  classification of an observed folder name as `canonical | repair-candidate | unknown`. Owns the
  movable-folder predicate. Input is the settings object, so behaviour is configuration-driven
  rather than hardcoded.
- `DriveTree` — takes a flat list of Drive file records (`id`, `name`, `parents`, `createdTime`,
  `mimeType`) plus the stored state and returns the reconstructed company/month/folder tree and a
  diff. The diff is the sole producer of `FileDiscovered`, `FileRenamedInDrive`,
  `FileMovedByClient` and `FileDeleted` events. No network calls in this module.
- `StatementParser` — a registry of per-bank parsers. Each maps decrypted statement text to
  `{ accountIban, periodStart, periodEnd, openingBalance, closingBalance, lines[] }`. Exposes
  `reconcile(statement)` which asserts opening + Σ movements == closing within a cent tolerance.
  See ADR 0009.
- `EkasaQr` — parses a decoded QR payload into receipt facts. Handles both documented variants:
  the 34-character UID form, and the composite form of OKP (44) + register code (16–17) +
  `YYMMDDHHMISS` + sequence number (1–6) + total amount (1–12).
- `Matcher` — takes candidate payments and proofs and returns ranked pairing suggestions with a
  reason. Tiers in order: exact VS match; amount + counterparty IBAN; amount + date proximity +
  fuzzy counterparty name; for card receipts, amount + timestamp proximity. Auto-pairs only when
  exactly one candidate matches at the top tier; otherwise suggests.
- `LateArrivals` — given files in a closed month, the month's `closedAt`, and the movable-folder
  settings, returns move proposals and non-movable warnings. Late detection is
  `createdTime > closedAt`, falling back to `firstSeenAt` when Drive reports an implausible
  creation time (client copies produce these).
- `InvoiceFields` — normalises and validates extracted invoice data. Owns the base + VAT == total
  assertion, currency normalisation, date sanity, and the merge rule that a manual correction
  always wins over a re-extraction.
- `IsdocExport` — maps confirmed invoice fields to ISDOC XML.

**Adapters behind ports**

- `DriveClient` — `list()`, `move()`, `rename()`, `createFolder()`, `watch()`. Every mutation
  checks the relevant `capabilities` field first (`canMoveItemWithinDrive`, `canRename`) and
  refuses rather than attempting and failing.
- `PdfAccess` — password-aware text extraction and embedded-image extraction, via `pdfjs-dist`.
  QR decoding via a WASM zxing binding. `libheif` conversion for HEIC photos.
- `Extractor` — the port for turning invoice text into structured fields. One implementation
  calls a hosted model; the interface is stable so it can be swapped or stubbed.
- `Store` — Drizzle repositories plus the append-only event log.
- `Settings` — global settings and per-company profiles. Statement passwords are encrypted with a
  key held in the environment, never in the database, so a leaked backup does not leak passwords.

### Sync design

The sweep is the single ingestion path. It is invoked by a debounced webhook and by dashboard load
when `lastSweepAt` is stale. The same load path re-watches the Drive channel when it expires
within a day. The sweep reads full Drive state and diffs it against the database, so a lost
notification or an expired channel costs latency, never correctness. See ADR 0003.

### Schema outline

Names indicative, not final.

- `companies` — drive folder id, name, active flag, folder-template override, encrypted statement
  password, statement password updated timestamp.
- `settings` — singleton row: canonical folder list, movable folder list, drive parent folder id.
- `months` — company, `YYYY_MM`, drive folder id, `closedAt`, `openedAt`.
- `files` — drive file id (primary), company, month, folder slot, name, mime type,
  `driveCreatedTime`, `firstSeenAt`, `lastSeenAt`, deleted flag.
- `payments` — company, month, source (`bank` | `cash`), statement file reference or bloček file
  reference, booking date, value date, amount, currency, counterparty name, counterparty IBAN,
  variabilný symbol, raw line text, `confirmedAt` (her tick), `exportedAt`, export batch.
- `proofs` — file reference, document kind, extraction status, extracted fields as JSON, manual
  overrides as JSON, validation result, notes.
- `pairings` — payment id, proof id, created by (`auto` | `manual`), confidence, reason. Composite
  unique key; many-to-many.
- `late_arrivals` — file reference, detected month, target month, status
  (`pending` | `moved` | `ignored` | `resolved`), resolution note.
- `drive_mutations` — kind (`move` | `rename` | `create`), file id, previous parent, previous
  name, new parent, new name, applied timestamp, undone timestamp. This is what makes undo real.
- `statements` — file reference, bank, parsed period, opening and closing balance, reconciliation
  result.
- `export_batches` — company, month, format, created timestamp, payment ids, file digest.
- `events` — append-only: timestamp, company, actor (`system` | `user`), type, payload JSON. The
  per-company activity log is a query over this table, not a separate structure.

### Interaction details

- Reconciliation screen is one route per company-month. Payments left, unpaired proofs right,
  suggestions inline, PDF preview pane, tick per payment. Folders act as a filter, not as
  navigation.
- Historical months render the same component in read-only mode. No separate screen.
- Extraction is triggered on discovery and runs a few documents in parallel; the UI shows pending
  state rather than blocking.
- Every Drive mutation is proposed, batch-confirmed, recorded in `drive_mutations`, and undoable.
  See ADR 0006.

---

## Testing Decisions

TDD throughout: a failing test precedes the implementation for every pure module. Tests assert
external behaviour — the mapping from inputs to outputs — never internal structure. Renaming a
private helper must not break a test.

`node:test` and `node:assert` from the standard library. No test framework, no fixture library, no
mocking library. Fakes are hand-written and live next to the port they implement.

### Unit tests — all eight pure modules

- `FolderTaxonomy` — canonical names accepted; `04 Bločky_hotorvosť` classified as
  repair-candidate with the right target; unknown folders not silently mapped; movable predicate
  driven by settings rather than a literal; `YYYY_MM` parsing rejects malformed names.
- `DriveTree` — tree reconstructed from an unordered flat list; a file appearing produces exactly
  one `FileDiscovered`; a file whose parent changed produces `FileMovedByClient`, not a
  discovery; a repeated sweep over unchanged input produces no events (idempotence); a file
  missing from a later sweep produces `FileDeleted` rather than vanishing.
- `StatementParser` — per bank, a redacted real statement fixture parses to the expected lines;
  `reconcile()` passes on a good statement and fails when a line is dropped or an amount is
  altered; a truncated statement fails rather than parsing partially.
- `EkasaQr` — both documented payload variants parsed; total amount and timestamp extracted
  exactly; malformed payloads rejected rather than coerced; field-length boundaries at the edges
  of the spec.
- `Matcher` — VS match beats amount match; a single top-tier candidate auto-pairs; two equal
  candidates suggest rather than auto-pair; one payment to three invoices summing to it is
  proposed; installments against one invoice are proposed; a near-miss amount does not match.
- `LateArrivals` — a file created after `closedAt` in a movable folder yields a move proposal to
  the open month, same folder slot; the same file in `03` or `07` yields a warning and no
  proposal; a file created before `closedAt` yields nothing; the `firstSeenAt` fallback triggers
  when `createdTime` is implausible.
- `InvoiceFields` — base + VAT == total passes and fails as expected; multiple VAT rates sum
  correctly; a manual override survives re-extraction; foreign currency is preserved; an
  implausible delivery date is flagged.
- `IsdocExport` — output validates against the ISDOC schema; a multi-rate invoice maps correctly;
  a missing mandatory field fails the build rather than emitting invalid XML.

### Integration tests

Real SQLite in a temporary file, real repositories, fake adapters.

- Sweep against a recorded Drive `files.list` response produces the expected tree, events and
  `files` rows; running it twice changes nothing.
- Full month walkthrough: statement parsed, invoices extracted via a stubbed `Extractor`,
  matcher suggestions produced, ticks applied, export generated, `exportedAt` stamped, second
  export warns.
- Move proposal accepted through the fake `DriveClient`, `drive_mutations` recorded, undo
  restores the original parent, events emitted in order.
- A statement failing reconciliation excludes its payments from the work list.
- Statement password encrypted at rest — the raw database file must not contain the plaintext.
- Capability refusal: a file reporting `canMoveItemWithinDrive: false` is not moved and surfaces
  an explanatory warning.

### End-to-end tests

Playwright against the app with a seeded database and the fake Drive adapter, so no real Google
calls and no real client data.

- Sign-in gate: an address outside the allowlist is refused.
- Company list shows the open month and unticked count.
- Reconciliation: accept a suggested pairing, tick the payment, see the remaining count decrease.
- Correct an extracted field and see the correction persist across a reload.
- Confirm a batch of late-arrival moves, then undo one.
- Close a month; next month's folders are created; the closed month becomes read-only.
- Generate an export and see the warning on a second attempt.

### Prior art

None — this is a greenfield repository. These tests establish the conventions.

---

## Open Questions

Carried forward deliberately. Each blocks a specific piece of work and nothing else.

1. **Omega export path for `01`, `04`, `05`, `06`.** ISDOC only lands received invoices — Omega
   imports it into Došlá faktúra, Došlá preddavková faktúra and Došlý dobropis. Issued invoices,
   cash bločky, card bločky and iné doklady need the TXT format (`R00`/`R01`/`R02` line codes;
   data types `T00` accounting documents, `T01` invoicing, `T08` payments), whose specification
   lives in `ImportExport_20_60.xls` at kros.sk/66711 and runs to ~166 columns for invoicing.
   Filip is returning to this. Blocks: the non-ISDOC half of `IsdocExport`. Recommended way to
   settle it is to watch her import one month manually.
2. **Bank statement samples.** Need one decrypted statement per bank to write each parser, and
   the per-company passwords. 3–6 layouts expected across her clients. Filip is obtaining the
   password. Blocks: `StatementParser`, and therefore the whole reconciliation screen.
3. **Which bank goes first.** Build one end-to-end before adding others.
4. **`canMoveItemWithinDrive` on a real client-uploaded file.** Clients upload into her folders,
   so clients own those files. Editor access through folder inheritance should permit the move,
   but this must be verified against one real file before the move feature is built. Blocks:
   `LateArrivals` execution (detection is unaffected).
5. **Single shared parent folder.** The service-account design assumes every company folder can
   sit under one parent that gets shared once. Needs confirmation that she can reorganise that
   way.
6. ~~**eBloček text layer.**~~ **Resolved, 2026-08-28.** `pdfjs-dist` reads these receipts fully;
   the earlier crude extractor was simply inadequate. `bloček_O-35E6…pdf` yields
   `Dátum a čas: 25.07.2026 11:30:27`, `NA ÚHRADU EUR | 1.20`, `SPOLU: | 0.98 | 0.22`, per-item rate
   quantity and unit price, plus the OKP and UID as text. The text layer supersedes the QR entirely
   rather than merely supplementing it — see the amendment to ADR 0008. Text items must be grouped
   into lines by y-coordinate; flattening them destroys the column structure.
7. **Extraction benchmark.** Label a subset of spring's 61 received invoices on the exact field
   set above; that becomes the permanent regression fixture. Note the 40 documents in
   `mix dokladov` are the wrong corpus — 27 of 40 are scans, which are the QR path and the manual
   path, not the invoice path.
8. **SQLite backup.** Drive remains the legal 10-year record, so a database loss costs pairing
   and extraction work rather than compliance. Still needs a plan.
9. **HEIC.** `libheif` conversion is needed for phone photos such as `IMG_3475.HEIC`. Low
   priority given the manual path for scans.
10. **Non-EUR documents.** A FlixBus ticket in the sample is priced in Czech koruna, and nothing in
    this PRD covers foreign currency. Decided for now: store the currency with the amount and flag
    non-EUR documents so she supplies the euro value; the app never invents an exchange rate. Still
    open is what Omega expects for such a payment, and whether the euro value she enters needs the
    rate and rate date recorded alongside it for the tax authority.
11. **`04` and `05` are not receipt-only.** Six of twenty PDFs in those folders are eBločeks; the
    rest are airline, train and bus tickets, ride-hailing invoices and fuel receipts, two with no
    text layer at all. Whether the mixed content is deliberate filing or drift is worth asking her,
    because it decides whether those document types deserve their own extraction path later.

---

## Out of Scope

- Multi-tenancy. One accountant, one deployment. No organisations, invitations or row-level
  security.
- Client-facing access. Her clients upload through Drive as they do today and never see this app.
- Becoming the document archive. Drive is the 10-year legal record; the app holds an index and
  derived data.
- Any use of the KROS Konektor API. It is e-shop oriented, paid, and imports only odoslané
  faktúry and došlé objednávky — not received invoices, which are the actual workload.
- Producing daňové priznanie DPH or kontrolný výkaz DPH. Omega does that; the app feeds Omega.
- Deciding Slovak tax treatment. The app surfaces warnings and she decides. No reason codes, no
  inferred deductibility, no chart-of-accounts assignment.
- OCR of scanned documents. Text layer plus eKasa QR covers the corpus; rare scans are entered by
  hand. See ADR 0008.
- Fine-tuning any model. 40 documents benchmarks; it does not train.
- Quarterly VAT handling. Folders are monthly regardless and the VAT period is Omega's concern.
- Real-time collaboration, notifications, email digests, mobile app.

## Further Notes

**Volume.** 5–15 companies, low hundreds of documents a month. This is the justification for
almost every simplification here: SQLite, no queue, no cron, synchronous database access, full
sweeps instead of delta sync.

**Evidence behind the extraction decision.** Of the 61 received invoices in the spring sample, 60
carry a text layer. That is why there is no OCR engine in this design. Of the 40 documents in
`mix dokladov`, 27 are scan-only — but those are receipts, which the eKasa QR handles
deterministically, and the residue is small enough to type.

**Why the model is payment-centric.** The first instinct was a document-processing app with
pairing bolted on. The correct model is the inverse: the statement is the spine, a payment is the
primary entity, and a proof is an attribute of a payment. Every downstream simplification follows
from that.

**Trust is the constraint on writes.** This app mutates folders belonging to her clients, and
Drive has no application-level undo. Hence: propose, batch-confirm, record, undo. A bad rule
applied silently across every client at once is the failure that ends the project.
