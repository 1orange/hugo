# 15 — Omega TXT `T00` (EUD) export with gate and batches

Type: AFK
Status: **Deferred, 2026-08-30.** Do not start.
User stories: 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63

> The route is decided (ADR 0014), but two unknowns make writing the exporter guesswork: the decimal
> separator for amounts, and whether an `R02` row may carry empty MD and DAL accounts. The spec shades
> all four account fields mandatory, so the decision to emit unposted documents may not be
> implementable as stated. Both are answered by the sample export in slice 07. Building first would
> risk either a silently wrong amount in her books or a file Omega refuses — see PRD open questions 1
> and 14.

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Getting confirmed data into Omega without retyping it. With pairing moved to Omega, this is the
app's finish line rather than a downstream nicety.

`OmegaTxtExport` is a pure module mapping confirmed documents to Omega's TXT import: one `R00` line
declaring the data type, then `R01` document headers each followed by one or more `R02` items. Per
ADR 0014 the format constraints are not negotiable — **Windows-1250** (not UTF-8), **TAB** (ASCII 9)
separators, **CRLF** line endings, dates as `DD.MM.RRRR`. Mandatory fields are encoded in the
specification as cell background colour rather than as text, which is worth knowing before reading
it.

The cash-versus-card distinction that ADR 0013 derives from the folder maps straight onto the
document type code in `R01`, chosen in the file rather than in the import dialogue: `160` for a
cash document, `180` for an internal document (KROS's own convention for card purchases, precisely
so the accountant can pair them against the statement herself), `130` for a received invoice, with
`330`/`360` as the foreign-currency twins. The codes for `01 Vystavené faktúry` and
`06 Iné doklady` are not yet known — PRD open question 13, settled by slice 07's sample.

**The app emits documents without double-entry accounts.** `R02` has MD and DAL fields, synthetic
and analytic, and the app leaves them empty; she posts the documents in Omega. This keeps the app
out of accounting judgement, consistent with ADR 0010. Whether Omega accepts an `R02` with those
fields empty is PRD open question 1(d) and is confirmed against slice 07's sample before any of
this is written.

Per ADR 0010 **her confirmation is the gate**. Nothing exports unless she confirmed it, and a
document she marked not relevant is absent by construction — which is how a proforma cannot
double-book.

Where a supplier already sent an **ISDOC** file, pass the original through untouched rather than
regenerating it. ISDOC is not the primary route: it reaches only the three received-invoice
ledgers, cannot express a cash receipt at all, and requires a fabricated `UUID` plus mandatory free
text and currency rates even on domestic invoices.

One export file per company, because Omega databases are per accounting entity. Export is a
once-a-month operation performed after the month's work is complete.

Import is **not transactional**: each record succeeds or fails independently, so a partial import
is a normal outcome rather than an error case. KROS documents that Omega's completion dialogue does
not mean the data imported; a `.LOG` file is written beside the input, referencing input line
numbers, and it is the only honest confirmation. The export is therefore not finished when the file
is written — she uploads the `.LOG` back, and the batch records what Omega actually took. Same
reasoning as ADR 0006's write-ahead intent: the artifact is not the outcome.

Two Omega behaviours worth defending against. Duplicate detection is a client-side setting under
*Firma – Nastavenia – Všeobecné nastavenia – Prechod/Import/Eshop*, and re-import normally refuses
with "such a document already exists" — but a duplicate header **silently orphans its items**,
which is a corruption mode worth a deliberate test. And partners are not auto-created, so an
unknown partner may need a `T04` block ahead of the documents.

`exportedAt` and an export batch are recorded per document. Because Omega cannot be asked what it
already holds, re-export protection lives entirely on our side: a second export warns rather than
silently duplicating entries in her books.

A preview shows what the export will contain before download.

> **Replaces** *15 — ISDOC export with gate and batches* and *18 — Omega TXT export path for issued
> invoices, bločky and iné doklady*. Slice 15 targeted ISDOC for received invoices and left four
> folders with no export path at all, which slice 18 recorded as blocked. ADR 0014 collapsed the two
> into one route: TXT covers every document type, ISDOC survives only as pass-through, and slice 18
> is deleted. Neither original slice produced any code.

## Acceptance criteria

- [ ] Output is Windows-1250 encoded, TAB separated and CRLF terminated, verified byte-wise rather than by eye
- [ ] Dates render as `DD.MM.RRRR`
- [ ] The decimal separator matches slice 07's sample exactly, and is not guessed
- [ ] The folder slot selects the `R01` document type code; a slot with no agreed code fails loudly rather than defaulting
- [ ] `R02` items carry no MD or DAL accounts, and a generated file with them empty imports into a test Omega company
- [ ] A multi-rate document maps base and VAT per rate correctly
- [ ] A foreign-currency document carries currency, unit quantity and totals in both currencies
- [ ] A string exceeding Omega's column size fails the build rather than being silently truncated
- [ ] Only confirmed documents are included
- [ ] A document marked not relevant is absent from the export
- [ ] A supplier's own ISDOC file is passed through byte-identical, never regenerated
- [ ] One file is produced per company
- [ ] `exportedAt` and a batch reference are recorded on every exported document
- [ ] A second export of already-exported documents warns explicitly
- [ ] An explicit re-export-everything path exists and is not the default
- [ ] Export contents are previewable before download
- [ ] Omega's `.LOG` file can be attached to a batch, and the batch shows which lines Omega accepted and which it rejected
- [ ] A partial import is representable — some documents exported and accepted, others exported and rejected
- [ ] The duplicate-header-orphans-its-items case is covered by a deliberate test against a test Omega company
- [ ] A generated file imports successfully into a test Omega company before any UI work is considered done
- [ ] `Exported` events are emitted
- [ ] E2E: export, then attempt a second export and observe the warning

## Blocked by

- 07 — Obtain a TXT export sample from her own Omega
- 11 — Invoice text extraction and field confirmation
- 22 — Document screen and schema

## Notes

KROS sells this exact workflow as Digitálna kancelária at €25.90 per company per month, with the
posting applied. It has no third-party ingest API, so it cannot be a channel for this app; it is a
competitor. At 10–15 companies that is €3,100–4,700 a year against a small VPS, which is why
building remains reasonable — but the overlap should stay a deliberate choice.
