# 20 — Bank statement presence

Type: AFK
User stories: 23, 24, 25

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The smallest feature in the project, and the one that replaces the largest deleted one.

Omega does the pairing, so a bank statement's only role here is to show that the client uploaded it
(ADR 0013). The app reports that a statement arrived in `03 Bankové výpisy` and when, and never
opens one. Every statement in the sample is AES-128 encrypted with its metadata encrypted too, so
presence is not merely all the app chooses to report — without the password it is all the app
*could* report, and it is not being given one.

There is **no new table**. Statement presence is a query over `files` where the folder slot is
`03 Bankové výpisy`: whether any non-deleted file exists for the company-month, how many, and the
earliest arrival time from `driveCreatedTime` with `firstSeenAt` as the fallback, exactly as
`LateArrivals` already treats implausible Drive timestamps. A second statement in the same month is
another arrival, not a replacement — a client with a mid-month export has two, and neither should
hide the other.

`03` is the only presence-only folder. Its files must never become documents, never be queued for
extraction, and never be opened by `PdfAccess`. `FolderTaxonomy` gains the processed-versus-
presence-only predicate so that this is one rule in one place rather than a condition scattered
across the sweep, the extractor and the export.

The month view shows statement arrivals as a plain list of file names and dates with no action on
them. The dashboard in slice 21 consumes the same query.

> This is what remains of *08 — Statement decrypt, parse and reconcile*, which is deleted. That
> slice specified per-company password storage, `pdfjs-dist` decryption, a registry of per-bank
> parsers and the `reconcile()` opening + Σ movements == closing assert. ADR 0009 records the
> analysis and is withdrawn rather than superseded, because nothing replaces it. Its
> `reconcile()` assert remains the right safeguard if statement parsing ever returns.

## Acceptance criteria

- [ ] A file in `03 Bankové výpisy` sets statement presence for its company-month
- [ ] Presence records the arrival time, falling back to `firstSeenAt` when `driveCreatedTime` is implausible
- [ ] A month with no statement is distinguishable from a month not yet swept
- [ ] Two statements in one month are both reported, and neither replaces the other
- [ ] A deleted statement file removes presence rather than leaving it stale
- [ ] No file in `03` becomes a document row
- [ ] No code path opens, decrypts, renders, extracts text from or OCRs a file in `03`
- [ ] No password field, prompt or column exists anywhere in the application
- [ ] `FolderTaxonomy` classifies `03` as presence-only and `07 Mzdy` as out of scope, from settings rather than a literal
- [ ] Integration test: a statement file appearing in a sweep sets presence, produces no document, and triggers no extraction

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
