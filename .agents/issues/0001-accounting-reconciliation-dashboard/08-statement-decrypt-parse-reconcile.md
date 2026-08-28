# 08 — Statement decrypt, parse and reconcile

Type: AFK
User stories: 25, 26, 27, 28, 29, 30

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The spine of the application. Per ADR 0002 every statement line becomes a `Payment`, and per
ADR 0009 parsing is deterministic rather than model-driven.

The per-company statement password is stored encrypted with a key held in the environment and never
in the database, so a leaked backup does not leak passwords. `pdfjs-dist` accepts a password and
extracts text in pure JavaScript — no `qpdf` binary on the critical path.

`StatementParser` is a registry of per-bank parsers. Each maps decrypted text to
`{ accountIban, periodStart, periodEnd, openingBalance, closingBalance, lines[] }`, where each line
carries booking date, value date, amount, currency, counterparty name, counterparty IBAN,
variabilný symbol and the raw line text. Only the first bank is implemented here.

`reconcile()` asserts **opening balance + Σ movements == closing balance** within a cent tolerance.
Its real purpose is not catching model error — there is no model — but catching a parser drifting
silently when a bank quietly changes its layout, which would otherwise poison an entire month of
pairing. A statement that fails is flagged loudly and its payments are excluded from the work list,
because reconciling against untrusted numbers is worse than not reconciling.

An unsupported bank must be a named, obvious gap in the UI, not an empty payment list.

Password rotation is handled by prompting **only when decryption actually fails**, never otherwise.

## Acceptance criteria

- [ ] The statement password is stored encrypted; the raw database file does not contain the plaintext
- [ ] A statement is decrypted and its text extracted without any external binary
- [ ] The first bank's fixture parses to the expected lines with exact amounts and dates
- [ ] `reconcile()` passes on the good fixture
- [ ] `reconcile()` fails when a line is removed from the fixture
- [ ] `reconcile()` fails when an amount is altered by one cent
- [ ] A truncated statement fails rather than parsing partially
- [ ] A failing statement is flagged in the UI and its payments are excluded from the work list
- [ ] An unrecognised bank layout produces a named "unsupported bank" state, not an empty list
- [ ] A second statement in the same month does not produce duplicate payments
- [ ] Failed decryption prompts for a new password, saves it, and retries; successful decryption never prompts
- [ ] Statement lines become `Payment` rows with `source = bank`
- [ ] Integration test: full statement to payments, including the reconciliation-failure exclusion path

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
- 07 — Obtain a decrypted statement sample
