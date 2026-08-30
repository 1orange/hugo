# PRD 0001 — Accounting Reconciliation Dashboard

Status: ready-for-agent
Owner: Filip
Primary user: single accountant (sole user of the system)

> **Scope change, 2026-08-30.** This document was written as a reconciliation dashboard, with the
> bank statement as the spine and pairing as the core feature. Pairing now happens in Omega and the
> app is not asked to read statements at all. See ADR 0013 (document-centric domain model) and
> ADR 0014 (Omega import via TXT `T00`). What the app actually is now is a document dashboard; the
> title is left alone so that the nineteen issue slices pointing at it keep pointing at it.
> Superseded passages below are marked rather than deleted, because they explain why the earlier
> shape was chosen.

---

## Current state, 2026-08-30

**Built:** walking skeleton with auth (01), Drive sweep and company/month tree (03), folder-name
repair (04), month close and scaffolding (05), eKasa receipts from the PDF text layer (06), the
reconciliation screen (09 — its pairing half is superseded), editable folder settings (14a) and the
activity log (16). Nothing is deployed and there is no production data.

**Next, and unblocked:** the document schema and merged screen (22), statement presence (20), the
chase dashboard (21).

**Deferred by choice — the export (15).** The route is settled and recorded in ADR 0014, but two
things are unknown and both are answered by one export from her own Omega (07): the decimal
separator for amounts, and whether an `R02` row may carry empty MD and DAL accounts. The second one
matters more than it sounds — the decision that the app emits unposted documents and she posts them
in Omega depends on it, and the spec's colour coding suggests the accounts are mandatory. Rather than
build against a guess and risk silently wrong amounts or a format Omega rejects, the export waits.
See open questions 1 and 14.

**Also deferred by choice:** the OCR path for the ~9% of documents with no text layer (open question
12, amendment to ADR 0008), automated chasing of clients by email, and per-company profiles.

**Waiting on Filip:** Drive service-account provisioning (02), the Omega export sample (07), and
labelling invoices for the extraction benchmark (10), which gates invoice extraction (11).

---

## Problem Statement

She is an accountant running the books for a handful of companies. Every client has a Google
Drive folder she owns and has shared with them; the client uploads documents into it and she
processes them once a month.

Today the work looks like this. She opens the client's month folder in Drive and goes through the
proofs the client uploaded — received invoices, cash and card receipts, issued invoices, other
documents. She retypes every one of them into Omega by hand — supplier, IČO, IČ DPH, invoice
number, variabilný symbol, tax base per rate, VAT, delivery date — because Omega needs that detail
to produce the daňové priznanie DPH and the kontrolný výkaz DPH. Omega then pairs those documents
against the bank statement itself; that part of the work is not hers to do by eye and is not this
app's job either.

Four specific pains:

1. **No memory of what's done.** Nothing records which documents she has already processed, so
   picking the work back up after an interruption means re-deriving it from scratch. She cannot
   answer "how much is left on this client?" without opening Drive and counting.
2. **Retyping.** The invoice data is already in the PDF. She types it a second time into Omega.
   This is where her hours go.
3. **Late arrivals land in closed months.** A client uploads a May invoice in July, after May is
   filed. It sits in the May folder where it will never be seen again, and it belongs in the open
   month because the VAT deduction gets claimed there.
4. **No visibility into who has uploaded.** Whether a client has delivered this month's statement
   and proofs at all is only knowable by opening seven Drive folders one at a time. Chasing the
   ones who have not is the work that gates every other step, and today it has no surface.

> **Superseded, 2026-08-30.** Pain 4 originally read: *"Pairing is manual and invisible. Matching
> each bank payment to its proof is done by eye, and a payment with no proof — which cannot legally
> be used in the accounting — is only caught if she happens to notice."* That described the workflow
> accurately at the time. Omega performs the pairing, so the app neither reads statements nor
> matches anything; what she actually lacks is a view of what has arrived. See ADR 0013.

## Solution

A single-user web dashboard, read-mostly over her existing Drive structure, that treats the
**document as the unit of work**.

Every proof file in a processed folder becomes a `Document`. The app extracts its data so she
confirms rather than retypes, and she puts each document into one of two terminal states —
confirmed, or not relevant with an optional reason. Both are her action; nothing is ever marked
done by inference. Confirmed documents, and only confirmed documents, reach the Omega export.

Bank statements are **presence-only**. The app reports that a statement arrived and when, and never
opens one. They are encrypted, they stay encrypted, and the app holds no password and no other
secret as a result.

The app never becomes the record of truth for documents — Drive stays the 10-year legal archive.
The app is the index, the extraction surface, and the memory of what has been done.

Concretely it gives her:

- A landing dashboard with one row per company: statement present for the open month, proofs
  arrived, documents left to process, and when the client last uploaded anything. This is the
  chase list and the work list in one screen.
- One company-month document screen, with folders acting as a filter rather than as navigation.
  PDF preview, extracted fields beside it, and her decision per document.
- Invoice fields extracted from the PDF text so she confirms rather than retypes.
- Receipt amounts, timestamps and per-rate VAT read from the eBloček text layer, with two
  arithmetic self-checks that must agree before the values are offered to her.
- A late-arrivals log with a proposed move into the open month, which she confirms in one click
  and can undo.
- An export of the confirmed documents as a TXT `T00` (EUD) file for import into Omega.
- Historical months, read-only, browsable the same way.

> **Superseded, 2026-08-30.** The original solution made every statement line and every cash bloček
> a `Payment`, documents `Proof` records attaching to them, and the reconciliation screen the place
> she lived. The reasoning was sound for a workflow where the app did the pairing; ADR 0002 records
> it and ADR 0013 records why it no longer holds.

## Domain Glossary

Terms used throughout this document and expected in the code.

| Term | Meaning |
| --- | --- |
| Company | One client of hers; one top-level Drive folder |
| Month folder | `YYYY_MM` directly under the company folder |
| `01 Vystavené faktúry` | Issued invoices (client's own sales) — processed |
| `02 Prijaté faktúry` | Received invoices (supplier invoices) — processed |
| `03 Bankové výpisy` | Bank statements (encrypted PDFs) — presence-only, never opened |
| `04 Bločky_hotovosť` | Cash receipts, paid from the till — processed |
| `05 Bločky_firemná karta` | Company card receipts — processed |
| `06 Iné doklady` | Other documents — processed |
| `07 Mzdy` | Payroll — out of scope |
| Processed folder | A folder whose files become documents: `01`, `02`, `04`, `05`, `06` |
| Presence-only folder | `03`; the app records that a file arrived and nothing about its contents |
| Document | One proof file in a processed folder; the primary entity |
| Awaiting decision | A document she has neither confirmed nor dismissed; the "what's left" count |
| Confirmed | Terminal state; her approval, and the gate that lets a document into the export |
| Not relevant | Terminal state; her dismissal, with an optional reason |
| Extracted payload | What a parser produced, as JSON |
| Confirmed payload | What she typed or accepted, as JSON, stored separately from the extracted one |
| VS | Variabilný symbol; on SK transfers usually equals the invoice number |
| IČ DPH | VAT identification number |
| eKasa / eBloček | The Slovak fiscal receipt system and its PDF receipt |
| OKP / UID | eKasa verification code / unique receipt identifier |
| Omega | KROS Omega, her double-entry accounting software |
| TXT `T00` (EUD) | Omega's text import format for accounting documents; the export route |
| `R00` / `R01` / `R02` | The data-type, document-header and item lines of that format |
| Document type code | Omega's code in `R01`: `160` cash, `180` internal, `130` received invoice, `330`/`360` foreign currency |
| ISDOC | XML invoice format Omega imports; used only to pass a supplier's original file through |
| Open month | The month currently being processed for a company |
| Closed month | A month she has explicitly closed after filing DPH |

> **Superseded, 2026-08-30.** `Payment` (a bank statement line, or a cash bloček), `Proof` (a
> document substantiating a payment) and `Pairing` (the many-to-many link between them) were the
> core of the glossary. They are gone with ADR 0013. `Payment` in particular no longer has a
> meaning here: Omega owns payments.

## User Stories

> **Renumbered, 2026-08-30.** The list was 72 stories; it is now 66, renumbered contiguously from 1.
> Sixteen were removed: the two statement-password stories and the five statement-parsing stories
> (the app never opens a statement), the eight pairing stories, and the card-receipt-matching story.
> Ten were added: statement presence and never-opening, the receipt arithmetic checks, cash-versus-
> card derived from the folder, the not-relevant terminal state, the merged document screen, the TXT
> format, emitting without accounts, ISDOC pass-through, and the `.LOG` confirmation. Where a story
> survives it keeps its wording verbatim.
>
> **Old → new**, survivors carried through unchanged: 1→1, 2→2, 6→4, 7→5, 8→6, 9→7, 10→8, 11→9,
> 12→10, 13→11, 14→12, 15→13, 18→14, 19→15, 20→16, 16→17, 17→18, 21→19, 22→20, 23→21, 24→22,
> 35→31, 36→32, 37→33, 38→34, 39→35, 40→36, 41→37, 51→41, 53→42, 54→43, 55→45, 56→46, 57→47,
> 58→48, 59→49, 60→50, 61→51, 62→52, 63→53, 65→55, 67→60, 68→61, 69→62, 70→64, 71→65, 72→66.
>
> **Rewritten in place** rather than removed: 3 (company list → chase dashboard), 30 (second
> statement → second arrival), 31 (eKasa QR → text layer) → 27, 32 (cash bloček as payment →
> document) → 26, 34 (manual-entry queue → empty payload) → 29, 50 (tick) → 38, 52 (remaining
> count) → 40, 64 (unticked proforma → not relevant) → 54, 66 (ISDOC → TXT `T00`) → 56.
>
> **Gone entirely:** old 4, 5, 25, 26, 27, 28, 29, 33, 42, 43, 44, 45, 46, 47, 48, 49.
>
> **New:** 23, 24, 28, 30, 39, 44, 57, 58, 59, 63.

### Setup and companies

1. As the accountant, I want to sign in with my Google account, so that nobody else can reach my clients' data.
2. As the accountant, I want the app to discover all company folders under one shared parent, so that I never register clients by hand.
3. As the accountant, I want the company list to be my landing dashboard, showing per company whether this month's statement has arrived, how many proofs have arrived, how many documents are still awaiting my decision and when the client last uploaded anything, so that I can see whom to chase and where to start in one screen.
4. As the accountant, I want to override the folder template for a specific company, so that a client with no employees does not get an empty `07 Mzdy` every month.
5. As the accountant, I want to mark a company inactive, so that a former client stops appearing in my work list without deleting the history.

### Global settings

6. As the accountant, I want to edit the canonical list of folder names, so that changing my filing convention does not require a code change.
7. As the accountant, I want to choose which folders are movable when a document arrives late, so that the app never moves a bank statement or payroll document across periods.
8. As the accountant, I want to see the folder template that new months will be created from, so that I can confirm it before it is applied to every client.

### Drive synchronisation

9. As the accountant, I want the app to notice new uploads without me pressing anything, so that the work list is current when I open it.
10. As the accountant, I want the app to catch up on everything that changed while I was away, so that a missed notification never means a lost document.
11. As the accountant, I want a manual Refresh, so that I can force a re-read when I have just uploaded something myself.
12. As the accountant, I want documents identified by their Drive file ID rather than their path, so that renaming or moving a file does not lose the work I have already done on it.
13. As the accountant, I want to see when the app last successfully read Drive, so that I can tell whether I am looking at stale information.

### Folder structure and repair

14. As the accountant, I want folders whose names do not match the canonical list flagged as unrecognised, so that a typo does not silently hide documents from me.
15. As the accountant, I want to fix a misnamed folder with one click, so that `04 Bločky_hotorvosť` becomes canonical without me editing Drive.
16. As the accountant, I want to be told that renaming a folder will not break my clients' links, so that I am comfortable clicking the repair button.

### Month lifecycle

17. As the accountant, I want next month's folders created for me when I close a month, so that I never build the structure by hand.
18. As the accountant, I want the open month's folders created automatically if they are missing, so that a client always has somewhere to upload.
19. As the accountant, I want to explicitly close a month per company, so that the app knows which documents arrived late rather than guessing from my filing habits.
20. As the accountant, I want to reopen a month I closed by mistake, so that a misclick is not permanent.
21. As the accountant, I want to browse any historical month read-only, so that I can answer a question about last February without risk of changing anything.
22. As the accountant, I want the VAT output PDFs at the month root left completely alone, so that the reports Omega produced are never touched.

### Bank statements — presence only

23. As the accountant, I want to see that a statement has arrived for a company's open month and when it landed, so that I know whether the client still owes me one.
24. As the accountant, I want the app to never open, decrypt or interpret a statement, so that it cannot be wrong about a number I did not ask it to read and I never hand it a bank password.
25. As the accountant, I want a second statement in the same month to show up as another arrival rather than replacing the first, so that a mid-month export does not look like the only one.

### Documents

26. As the accountant, I want every file in a processed folder to become a document I can act on, so that `01`, `02`, `04`, `05` and `06` all reach the same work list.
27. As the accountant, I want an eBloček's total, timestamp, per-item lines and VAT recapitulation read from its text layer, so that a till or card purchase reaches Omega without me typing it.
28. As the accountant, I want a receipt whose line totals or base-plus-VAT do not add up to be shown with the discrepancy rather than accepted, so that a misread digit cannot reach my books.
29. As the accountant, I want a document the app could not parse to arrive with empty fields I can fill in, so that a scan or an unrecognised layout is the same flow as everything else rather than a separate queue.
30. As the accountant, I want whether a document is cash or card taken from the folder it sits in, so that moving a misfiled receipt changes its treatment instead of leaving it stale.

### Invoice extraction

31. As the accountant, I want the fields of a received invoice read out of the PDF, so that I confirm them instead of retyping them into Omega.
32. As the accountant, I want the extracted supplier, IČO, IČ DPH, invoice number, variabilný symbol, issue date, delivery date, tax base per rate, VAT per rate, total and currency shown next to the PDF, so that I can check them at a glance.
33. As the accountant, I want the app to verify that base plus VAT equals total, so that a misread digit is caught before it reaches my books.
34. As the accountant, I want to correct any extracted field, so that my correction rather than the machine's guess is what gets exported.
35. As the accountant, I want my correction remembered, so that re-reading the document does not overwrite what I fixed.
36. As the accountant, I want a foreign-currency invoice to keep its currency and amount, so that a CZK or USD document is not silently treated as euro.
37. As the accountant, I want extraction to run without me waiting for it, so that opening a month is fast even when many documents are new.

### Decisions and progress

38. As the accountant, I want to confirm a document, so that my own judgment rather than the system's inference decides what is finished, and so that it becomes eligible for export.
39. As the accountant, I want to mark a document not relevant with an optional reason, so that a proforma, a duplicate or a stray file leaves my work list deliberately instead of sitting there forever.
40. As the accountant, I want "what's left" to count only documents awaiting my decision, so that the number can actually reach zero and stays worth looking at.
41. As the accountant, I want the derived status shown as a hint alongside my decision, so that I can see what the app thinks without it overruling me.
42. As the accountant, I want to leave a note on a document, so that I can record why something is unusual before I forget.
43. As the accountant, I want to see at a glance which stage of the monthly cycle a company is at, so that I can plan the order I work in.
44. As the accountant, I want one screen per company-month listing every document with folders as a filter, so that I am not navigating between a folder view and a separate work view for the same month.

### Late arrivals

45. As the accountant, I want every document that arrives in a closed month logged, so that nothing that landed late is lost.
46. As the accountant, I want each late arrival to carry a status of pending, moved, ignored or resolved, so that I can clear the list deliberately.
47. As the accountant, I want a proposed move into the open month for late arrivals in movable folders, so that the VAT deduction lands in the period where I will claim it.
48. As the accountant, I want to confirm all proposed moves for a company in one click, so that clearing the list is fast.
49. As the accountant, I want a late arrival in a non-movable folder shown as a warning instead of a move, so that a late bank statement or payroll document is never relocated.
50. As the accountant, I want to ignore a late arrival, so that a duplicate upload does not stay on my list forever.
51. As the accountant, I want to undo a move, so that a mistake in someone else's Drive is recoverable.
52. As the accountant, I want the destination subfolder created if it does not exist, so that a move never fails for a missing folder.

### Export to Omega

53. As the accountant, I want only confirmed documents included in the export, so that nothing reaches my books without my approval.
54. As the accountant, I want a document I marked not relevant to be absent from the export, so that a proforma cannot double-book an expense.
55. As the accountant, I want one export file per company, so that I import into the right Omega company database.
56. As the accountant, I want the export written as Omega's TXT `T00` (EUD) format with the right document type code per folder, so that a cash receipt, a card purchase and a received invoice each land in the evidence they belong to.
57. As the accountant, I want the file written in Windows-1250 with TAB separators, CRLF line endings and `DD.MM.RRRR` dates, so that Omega reads it rather than rejecting it or mangling my diacritics.
58. As the accountant, I want the documents emitted without double-entry accounts, so that the posting stays my judgment in Omega and the app never guesses a chart-of-accounts line.
59. As the accountant, I want a supplier's own ISDOC file passed through untouched, so that a document that already exists in a format Omega imports is not regenerated and degraded.
60. As the accountant, I want to be warned when I export something that was exported before, so that I do not double-book it in Omega.
61. As the accountant, I want the export to record what it contained and when, so that I can reconstruct what I imported if Omega and the dashboard disagree.
62. As the accountant, I want to see what the export will contain before I download it, so that I can spot a mistake before it reaches Omega.
63. As the accountant, I want to record which documents Omega's `.LOG` file actually accepted, so that a partial import is visible rather than assumed successful.

### Audit and history

64. As the accountant, I want a per-company activity log of everything the app and I did, so that I can explain any change to a client.
65. As the accountant, I want every Drive write recorded with enough detail to reverse it, so that undo is trustworthy rather than best-effort.
66. As the accountant, I want to see when a document first appeared, so that I can tell a client when they actually uploaded it.

---

## Implementation Decisions

Decisions with meaningful alternatives are recorded as ADRs in `docs/adrs/`. This section covers
module boundaries, interfaces and schema.

| ADR | Decision |
| --- | --- |
| 0001 | Drive access via a service account, not OAuth |
| 0002 | ~~Payment-centric domain model, many-to-many pairing~~ — superseded by 0013 |
| 0003 | Sweep-based sync, webhook as trigger, no scheduler |
| 0004 | SQLite on a single EU VPS; extracted data as JSON inside it |
| 0005 | Explicit month close as the lifecycle anchor |
| 0006 | Drive mutations proposed, recorded and reversible |
| 0007 | Canonical folder names with a one-time rename repair |
| 0008 | No OCR engine — text layer; OCR deferred, not rejected |
| 0009 | ~~Per-bank statement parsers with a reconciliation assert~~ — withdrawn, nothing replaces it |
| 0010 | Her decision is authoritative and gates the export; two terminal states |
| 0011 | App auth via Auth.js Google, separate from Drive credentials |
| 0012 | Append-only domain event log |
| 0013 | Document-centric domain model; statements are presence-only |
| 0014 | Omega import via the TXT `T00` (EUD) format, not ISDOC |

### Platform

- Next.js App Router, TypeScript, Tailwind, shadcn/ui.
- Single small EU VPS, Caddy in front for TLS, Next running as a systemd service.
- SQLite via `better-sqlite3` with Drizzle. Synchronous access is acceptable and desirable at
  single-user scale. See ADR 0004.
- No scheduler. See ADR 0003.
- Node only — no Python sidecar, no OCR engine today. See ADR 0008.
- **The app stores no secret except its own service-account and model API keys.** Statement
  passwords are gone with ADR 0009's withdrawal, and the database holds nothing confidential to
  decrypt.

### Module boundaries

Risky logic is pure and testable without Drive or a model. I/O sits in thin adapters behind ports.

**Pure modules**

- `FolderTaxonomy` — month folder naming (`YYYY_MM`), canonical subfolder list, and
  classification of an observed folder name as `canonical | repair-candidate | unknown`. Owns the
  movable-folder predicate and the processed-versus-presence-only predicate. Input is the settings
  object, so behaviour is configuration-driven rather than hardcoded.
- `DriveTree` — takes a flat list of Drive file records (`id`, `name`, `parents`, `createdTime`,
  `mimeType`) plus the stored state and returns the reconstructed company/month/folder tree and a
  diff. The diff is the sole producer of `FileDiscovered`, `FileRenamedInDrive`,
  `FileMovedByClient` and `FileDeleted` events. No network calls in this module.
- `EkasaText` — parses eBloček text-layer lines into receipt facts: total with currency, local
  timestamp, per-item name, rate, quantity and unit price, VAT recapitulation per rate, UID and
  OKP. Owns both arithmetic self-checks. See the amendment to ADR 0008 for the layout traps.
- `LateArrivals` — given files in a closed month, the month's `closedAt`, and the movable-folder
  settings, returns move proposals and non-movable warnings. Late detection is
  `createdTime > closedAt`, falling back to `firstSeenAt` when Drive reports an implausible
  creation time (client copies produce these).
- `InvoiceFields` — normalises and validates extracted invoice data. Owns the base + VAT == total
  assertion, currency normalisation, date sanity, and the merge rule that the confirmed payload
  always wins over a re-extraction.
- `DocumentState` — the two terminal states and the awaiting-decision predicate that the counts on
  the dashboard read from. Nothing may set a terminal state by inference.
- `OmegaTxtExport` — maps confirmed documents to the TXT `T00` (EUD) layout: one `R00`, then `R01`
  headers each followed by `R02` items. Owns the document type code per folder slot (`160`, `180`,
  `130`, `330`/`360`), Windows-1250 encoding, TAB separation, CRLF endings and `DD.MM.RRRR` dates.
  Emits no double-entry accounts. See ADR 0014.

> **Superseded, 2026-08-30.** `StatementParser` (per-bank parsers plus the `reconcile()` balance
> assert), `EkasaQr` (both documented QR payload variants), `Matcher` (tiered pairing suggestions)
> and `IsdocExport` were specified here. None were built. `EkasaQr` was replaced by the text layer
> in the 2026-08-28 amendment to ADR 0008; the other three died with ADR 0013 and ADR 0014.

**Adapters behind ports**

- `DriveClient` — `list()`, `move()`, `rename()`, `createFolder()`, `watch()`. Every mutation
  checks the relevant `capabilities` field first (`canMoveItemWithinDrive`, `canRename`) and
  refuses rather than attempting and failing.
- `PdfAccess` — text extraction via `pdfjs-dist`, grouping text items into lines by y-coordinate.
  `libheif` conversion for HEIC photos. No password handling: the app never opens an encrypted PDF.
- `Extractor` — the port for turning invoice text into structured fields. One implementation
  calls a hosted model; the interface is stable so it can be swapped or stubbed. When OCR lands it
  is a second implementation behind the same port, emitting the same payload.
- `Store` — Drizzle repositories plus the append-only event log.
- `Settings` — global settings and per-company profiles. No secrets.

### Sync design

The sweep is the single ingestion path. It is invoked by a debounced webhook and by dashboard load
when `lastSweepAt` is stale. The same load path re-watches the Drive channel when it expires
within a day. The sweep reads full Drive state and diffs it against the database, so a lost
notification or an expired channel costs latency, never correctness. See ADR 0003.

### Schema outline

Names indicative, not final.

- `companies` — drive folder id, name, active flag, folder-template override.
- `settings` — singleton row: canonical folder list, movable folder list, drive parent folder id.
- `months` — company, `YYYY_MM`, drive folder id, `closedAt`, `openedAt`.
- `files` — drive file id (primary), company, month, folder slot, name, mime type,
  `driveCreatedTime`, `firstSeenAt`, `lastSeenAt`, deleted flag.
- `documents` — drive file id (primary, references `files`), company, month, folder slot,
  `decision` (`awaiting` | `confirmed` | `not-relevant`), not-relevant reason, decided timestamp,
  extraction state and failure reason, **extracted payload JSON**, **confirmed payload JSON**,
  note, `exportedAt`, export batch. Workflow fields are columns because they are queried
  constantly; everything a parser produces is payload because it is only ever read whole. Cash
  versus card is *not* a column — it is derived from `folderSlot`. See ADR 0004's amendment and
  ADR 0013.
- Statement presence needs **no table**: it is a query over `files` where the folder slot is
  `03 Bankové výpisy`, which already carries `driveCreatedTime` and `firstSeenAt`.
- `late_arrivals` — file reference, detected month, target month, status
  (`pending` | `moved` | `ignored` | `resolved`), resolution note.
- `drive_mutations` — kind (`move` | `rename` | `create`), file id, previous parent, previous
  name, new parent, new name, applied timestamp, undone timestamp. This is what makes undo real.
- `export_batches` — company, month, format, created timestamp, document ids, file digest, and the
  outcome recorded from Omega's `.LOG` file.
- `events` — append-only: timestamp, company, actor (`system` | `user`), type, payload JSON. The
  per-company activity log is a query over this table, not a separate structure.

> **Superseded, 2026-08-30.** `payments`, `proofs`, `pairings`, `statements` and
> `receipt_manual_queue` were specified and partly built. See *Superseded implementation, now
> deletable* at the end of this document, and slice 22.

### Interaction details

- The company list is the landing dashboard. Per company: statement present for the open month,
  proofs arrived, documents awaiting decision, last client upload.
- One document route per company-month. Documents in a list, folders as a filter, preview pane,
  extracted fields beside it, her decision per document. The old month view and reconciliation view
  are the same screen.
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

### Unit tests — all seven pure modules

- `FolderTaxonomy` — canonical names accepted; `04 Bločky_hotorvosť` classified as
  repair-candidate with the right target; unknown folders not silently mapped; movable predicate
  driven by settings rather than a literal; `03 Bankové výpisy` classified presence-only and
  `07 Mzdy` out of scope; `YYYY_MM` parsing rejects malformed names.
- `DriveTree` — tree reconstructed from an unordered flat list; a file appearing produces exactly
  one `FileDiscovered`; a file whose parent changed produces `FileMovedByClient`, not a
  discovery; a repeated sweep over unchanged input produces no events (idempotence); a file
  missing from a later sweep produces `FileDeleted` rather than vanishing.
- `EkasaText` — the real corpus's six eBločeks parse with both arithmetic checks passing; a
  recapitulation row is not mistaken for an item row; trailing-zero differences compare by value in
  minor units; a non-eBloček in `04` or `05` yields an empty payload rather than a partial one; NFD
  input matches the NFC labels.
- `LateArrivals` — a file created after `closedAt` in a movable folder yields a move proposal to
  the open month, same folder slot; the same file in `03` or `07` yields a warning and no
  proposal; a file created before `closedAt` yields nothing; the `firstSeenAt` fallback triggers
  when `createdTime` is implausible.
- `InvoiceFields` — base + VAT == total passes and fails as expected; multiple VAT rates sum
  correctly; the confirmed payload survives re-extraction; foreign currency is preserved; an
  implausible delivery date is flagged.
- `DocumentState` — a document with an empty payload is still awaiting a decision; neither terminal
  state is ever reached without an explicit action; the awaiting count reaches zero when every
  document is confirmed or dismissed.
- `OmegaTxtExport` — the folder slot picks the document type code; output is Windows-1250, TAB
  separated and CRLF terminated; dates render as `DD.MM.RRRR`; a string exceeding Omega's column
  size fails the build rather than being truncated; no double-entry accounts are emitted; a
  supplier ISDOC file is passed through byte-identical.

### Integration tests

Real SQLite in a temporary file, real repositories, fake adapters.

- Sweep against a recorded Drive `files.list` response produces the expected tree, events and
  `files` rows; running it twice changes nothing.
- Full month walkthrough: documents discovered, receipts parsed, invoices extracted via a stubbed
  `Extractor`, some confirmed and some dismissed, export generated, `exportedAt` stamped, second
  export warns.
- A statement file appearing in `03` sets presence for the month and produces no document row, no
  extraction attempt and no decryption attempt.
- Move proposal accepted through the fake `DriveClient`, `drive_mutations` recorded, undo
  restores the original parent, events emitted in order.
- The awaiting-decision count falls to zero only when every document has a terminal state.
- Capability refusal: a file reporting `canMoveItemWithinDrive: false` is not moved and surfaces
  an explanatory warning.

### End-to-end tests

Playwright against the app with a seeded database and the fake Drive adapter, so no real Google
calls and no real client data.

- Sign-in gate: an address outside the allowlist is refused.
- Dashboard shows, per company, statement presence, proofs arrived, documents awaiting decision and
  last client upload.
- Confirm a document and mark another not relevant; see the remaining count fall to zero.
- Correct an extracted field and see the correction persist across a reload.
- Confirm a batch of late-arrival moves, then undo one.
- Close a month; next month's folders are created; the closed month becomes read-only.
- Generate an export and see the warning on a second attempt.

### Prior art

None — this is a greenfield repository. These tests establish the conventions.

---

## Open Questions

Carried forward deliberately. Each blocks a specific piece of work and nothing else. Numbering is
stable across the 2026-08-30 scope change so that issue slices referring to a question still point
at the same thing; withdrawn and resolved entries keep their numbers.

1. **Omega export path.** **Largely resolved, 2026-08-30 — see ADR 0014.** The route is the TXT
   `T00` (EUD) format, not ISDOC: ISDOC reaches only received-invoice ledgers and cannot express a
   receipt, while TXT covers every type via document-type codes (`160` cash, `180` card as an
   internal document, `130` received invoice, `330`/`360` foreign currency). ISDOC survives only as
   pass-through of a supplier's original file. The spec reference in this PRD was wrong —
   kros.sk/66711 is dead and the current file is `ImportExport_28_00_2025.xls` on ftpkros.sk. `T08`
   payments is **export-only**, so the superseded payment-centric model could never have exported to
   Omega at all. There is no usable API.
   **Also resolved, 2026-08-30:** the double-entry accounts question. The app emits documents
   **without** MD/DAL accounts and she posts them in Omega, which keeps the app out of accounting
   judgement, consistent with ADR 0010. ADR 0014's consequence list still records this as the
   largest open question in the export and now trails the decision.
   **Still open:** (a) the decimal separator for amounts, verified absent from all 16 sheets of the
   spec; (b) whether Omega 29.20 accepts a file built to the 28.00 spec; (c) whether the `>>`
   optional-field boundary is mandatory as a row, where the colour coding and the `>>` legend
   disagree; (d) whether Omega accepts an `R02` row with the MD and DAL account fields left empty —
   the decision above assumes it does, and nothing in the spec confirms it.
   All four are settled by **one export from her own Omega** (*Firma – Export – Export do textového
   súboru*, data type "Doklady EUD") after she enters one cash receipt, one card purchase and one
   foreign-currency receipt by hand. Because export and import share the format, that file is the
   specification. This is the highest-value outstanding item in the project. See slice 07.
2. ~~**Bank statement samples.**~~ **Withdrawn, 2026-08-30.** The app no longer reads statements;
   presence is the only signal (ADR 0013, ADR 0009 withdrawn). No decrypted sample and no password
   is needed from her, and the app stores no secret as a result.
3. ~~**Which bank goes first.**~~ **Withdrawn** with open question 2.
4. **`canMoveItemWithinDrive` on a real client-uploaded file.** **No longer blocking, 2026-08-30**,
   after a read-only probe of the live Drive (`scripts/probe-drive.mts`, counts only, no names).
   Across **353 real documents** under the configured parent, `canMoveItemWithinDrive` and
   `canRename` are **true on every one**, and the capability is *reported* on every one — never
   absent, which is what the optional field in `DriveCapabilities` was defensive about.
   **The strict question is still unobserved:** there is exactly one distinct document owner and it
   is not the service account, so these are one human account's uploads — almost certainly hers. A
   file genuinely owned by a *client* does not exist in the data yet.
   This stops blocking `LateArrivals` regardless, because the capability is per file and already
   read per file: slice 13 must check the flag at move time and refuse with an explanation when it
   is false, rather than assuming an answer. Re-run the probe once a client has uploaded, to confirm
   the common case rather than to unblock the work.
5. **Single shared parent folder.** **Confirmed in practice, 2026-08-30.** All 353 documents resolve
   under the configured parent, so the design holds. Provisioning is only **partial**: 2 companies
   are under the parent against an eventual 5–15, so slice 02 is not finished.
6. ~~**eBloček text layer.**~~ **Resolved, 2026-08-28.** `pdfjs-dist` reads these receipts fully;
   the earlier crude extractor was simply inadequate. `bloček_O-35E6…pdf` yields
   `Dátum a čas: 25.07.2026 11:30:27`, `NA ÚHRADU EUR | 1.20`, `SPOLU: | 0.98 | 0.22`, per-item rate
   quantity and unit price, plus the OKP and UID as text. The text layer supersedes the QR entirely
   rather than merely supplementing it — see the amendment to ADR 0008. Text items must be grouped
   into lines by y-coordinate; flattening them destroys the column structure.
7. **Extraction benchmark.** Label a subset of spring's 61 received invoices on the exact field
   set above; that becomes the permanent regression fixture. Note the 40 documents in
   `mix dokladov` are the wrong corpus — 27 of 40 are scans, which are the deferred OCR path and
   the manual path, not the invoice path.
8. **SQLite backup.** Drive remains the legal 10-year record, so a database loss costs extraction
   and decision work rather than compliance. Still needs a plan. Note that the database no longer
   holds any secret, which simplifies it: there is no key custody problem any more.
9. ~~**HEIC.** `libheif` conversion is needed for phone photos such as `IMG_3475.HEIC`. Low
   priority given the manual path for scans.~~ **Resolved in slice 09.** Converted server-side by
   `libheif` compiled to WASM (`heic-convert`), so the VPS needs no native build and the browser
   needs no decoder. Verified against the one real HEIC in the corpus: valid JPEG out, 1.1s for a
   2.5 MB photo, which is why the conversion is not cached yet.
10. **Non-EUR documents.** A FlixBus ticket in the sample is priced in Czech koruna. Decided:
    store the currency with the amount and flag non-EUR documents so she supplies the euro value;
    the app never invents an exchange rate. **Partly answered, 2026-08-30 by ADR 0014:** the TXT
    format carries currency, unit quantity, the ECB rate and the bank rate plus totals in both
    currencies, and there is **no rate-date field** — Omega derives it from DUÚP, and where both
    rates are supplied the bank rate wins. **Still open:** what Omega expects for foreign-currency
    rate dates in practice, given the legal requirement is the ECB rate from the day before the
    accounting event. Settled by the same sample export as question 1, plus one foreign-currency
    document entered by hand.
11. **`04` and `05` are not receipt-only.** Six of twenty PDFs in those folders are eBločeks; the
    rest are airline, train and bus tickets, ride-hailing invoices and fuel receipts, two with no
    text layer at all. Whether the mixed content is deliberate filing or drift is worth asking her,
    because it decides whether those document types deserve their own extraction path later.
12. **Does the 9% no-text-layer rate generalise?** Measured across the spring corpus: 11 of 126
    documents in processed folders have no usable text layer, concentrated in `Potvrdenie_*` card
    confirmations in `05`. That is one to two per company per month, which is why OCR is deferred
    rather than built (amendment to ADR 0008). But spring may be the tidy client — the separate
    `mix dokladov` pile ran 27 scans out of 40. The trigger for building the OCR path is real counts
    across all her clients once the app is in use, so this stays open until there are some.
13. ~~**Omega document type codes for `01` and `06`.**~~ **Mostly resolved, 2026-08-30** by reading
    the spec's `EUD` sheet directly — the codes were missing from the research summary, not from
    Omega. The full set is in the amendment to ADR 0014: issued invoices are `100` (OF), or `300`
    (zOF) in foreign currency.
    **Still open:** `06 Iné doklady` cannot be mapped to a code at all, because it is a folder for
    miscellaneous documents rather than a document type — its code depends on what each document
    turns out to be, so this is a per-document question. Also still open are her per-company evidence
    codes and number-series codes, which must already exist in her Omega and are therefore
    configuration rather than constants. The sample export in slice 07 gives both.
14. **Do the `R02` account fields accept an empty value?** The decision was that the app emits
    documents unposted and she posts them in Omega. Reading the spec's cell colouring directly
    shows all four account fields shaded mandatory for `T00` items, with one later item variant
    relaxing only the analytic pair. Whether the marking means "a value is required" or "the tab
    position must exist" is undocumented, and it decides whether the intended workflow is possible.
    See the amendment to ADR 0014 for the fallbacks if it is not. Settled by the same sample export.

---

## Out of Scope

- Multi-tenancy. One accountant, one deployment. No organisations, invitations or row-level
  security.
- Client-facing access. Her clients upload through Drive as they do today and never see this app.
- **Automated emails or messages to clients.** Chasing is presence information on a screen; she
  does the pinging with her own wording.
- **An expected-document model.** No per-company expected account counts, no "you should have three
  statements this month". The app reports what arrived, not what should have.
- **Reading bank statements.** No decryption, no per-bank parsers, no balance assert, no stored
  passwords. Presence and arrival time only. See ADR 0013 and the withdrawal of ADR 0009.
- **Pairing.** Omega pairs documents against the statement. No `Payment`, no pairings, no match
  suggestions.
- Becoming the document archive. Drive is the 10-year legal record; the app holds an index and
  derived data.
- Any use of the KROS Konektor API. It is e-shop oriented, paid, and imports only odoslané
  faktúry and došlé objednávky — not received invoices, which are the actual workload.
- Producing daňové priznanie DPH or kontrolný výkaz DPH. Omega does that; the app feeds Omega.
- Deciding Slovak tax treatment, and **assigning double-entry accounts**. The app surfaces
  documents and she posts them. No reason codes, no inferred deductibility, no chart-of-accounts
  assignment.
- `07 Mzdy`. Payroll is out of scope entirely.
- OCR of scanned documents, **for now**. Deferred rather than rejected: 11 of 126 documents in the
  processed folders have no text layer, which does not justify a runtime yet. The intended shape
  when it lands is rules first, then RapidOCR on ONNX for images, then a small local model (~0.8B
  Qwen) structuring the text into the same JSON payload, always confirmed by her. See ADR 0008.
- Fine-tuning any model. 40 documents benchmarks; it does not train.
- Quarterly VAT handling. Folders are monthly regardless and the VAT period is Omega's concern.
- Real-time collaboration, notifications, email digests, mobile app.

## Further Notes

**Volume.** 5–15 companies, low hundreds of documents a month. This is the justification for
almost every simplification here: SQLite, no queue, no cron, synchronous database access, full
sweeps instead of delta sync.

**Evidence behind the extraction decision.** Of the 61 received invoices in the spring sample, 60
carry a text layer, and every eBloček parses from its text layer with two arithmetic checks
passing. That is why there is no OCR engine in this design. Across all 126 documents in processed
folders, 11 lack a usable text layer — six of them `Potvrdenie_*` card confirmations in `05`, three
phone photos and one image-only PDF in `04`, and one scanned invoice in `02`. All 39 issued invoices
in `01` carry text.

**Why the model is document-centric.** Her process is to process the proofs a client uploaded and
hand the result to Omega, which does the pairing. Each document needs one decision from her and
nothing else does, which makes "what's left" a document count that can genuinely reach zero. The
statement is not an input to be parsed; its presence is the signal. See ADR 0013.

> **Superseded, 2026-08-30.** This note previously read: *"Why the model is payment-centric. The
> first instinct was a document-processing app with pairing bolted on. The correct model is the
> inverse: the statement is the spine, a payment is the primary entity, and a proof is an attribute
> of a payment. Every downstream simplification follows from that."* It was right about the workflow
> as described at the time. The workflow changed. Amusingly, the first instinct turned out to be the
> destination.

**Trust is the constraint on writes.** This app mutates folders belonging to her clients, and
Drive has no application-level undo. Hence: propose, batch-confirm, record, undo. A bad rule
applied silently across every client at once is the failure that ends the project.

**The export is not done when the file is written.** Omega's import is not transactional, each
record succeeds or fails independently, and KROS documents that its own success dialogue does not
mean the data imported. The `.LOG` file written beside the input is the only honest confirmation.
This is the same reasoning as ADR 0006's write-ahead intent: the artifact is not the outcome.

---

## Superseded implementation, now deletable

Built against the payment-centric model and no longer reachable under ADR 0013. Nothing is
deployed and there is no production data, so this is deletion rather than migration. The work is
slice 22, which carries the full per-file list and the acceptance criteria; the summary is:

- the `pairings`, `proofs` and `receipt_manual_queue` tables, and the `payments` table reshaped
  into `documents` with its eKasa columns folded into the extracted payload;
- the pairing half of the reconciliation screen and the four server actions behind it;
- `src/adapters/store/pairings.ts` and `src/adapters/store/proofs.ts` in their entirety;
- the pairing predicates in `src/modules/reconciliation.ts` and the pair/unpair services;
- the `Paired` and `Unpaired` event types, and the `pair` company stage.

Slices 08 (statement decrypt, parse and reconcile), 12 (matcher suggestions) and 15 as originally
written (ISDOC export) never produced code, so they cost nothing to withdraw.
