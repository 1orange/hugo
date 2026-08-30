# 07 — Obtain a TXT export sample from her own Omega

Type: HITL
Resolves: PRD open questions 1, 10, 13 and 14

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Human groundwork. No application code, but slice 15 — and therefore the finish line of the whole
application — should not start without it.

> This slice replaces *07 — Obtain a decrypted statement sample*, which asked for statement
> passwords and one statement per bank so that per-bank parsers could be written. The app no longer
> opens a statement (ADR 0013, ADR 0009 withdrawn), so none of that is needed and no secret is
> collected from her at all. What remains genuinely blocking is the other sample this project needs,
> so the slot is reused rather than left empty.

One line in the KROS specification's General Description sheet shapes everything: *"Export and
import of Omega use the same file format. You can obtain a sample import file by exporting the same
data from Omega."* The authoritative reference for our writer is therefore a file from her own
installation, not the published spreadsheet — which is for Omega **28.00**, last saved November
2024, while the shipping program is **29.20**.

Ask her to enter five documents by hand into a test company, one of each kind the export must
cover, and then export them:

- one cash receipt (pokladničný doklad, type `160`),
- one card purchase booked as an internal document (type `180`),
- one received invoice (type `130`),
- one foreign-currency document (the `z` twins, `330`/`360`),
- one issued invoice (type `100`).

Then *Firma – Export – Export do textového súboru*, data type **"Doklady EUD"**.

That single file settles, by inspection, everything ADR 0014 refused to guess: the decimal separator
for amounts; whether 29.20 writes anything the 28.00 spec does not describe; whether the `>>`
optional-field boundary appears as a row; **whether an `R02` row can carry empty MD and DAL
accounts**, which the decision to emit unposted documents depends on and which the spec's colour
coding suggests it cannot; what Omega puts in the foreign-currency rate fields and what it does
about rate dates; and her evidence codes and number series per document type.

The account question is the one to look at first. If Omega requires the accounts, the plan to emit
unposted documents does not work as designed and needs one of the fallbacks in ADR 0014's amendment.

The specification itself is already in this repository at `docs/reference/omega/`, vendored because
the reference this project started from (kros.sk/66711) is dead.

The exported file contains her own test data rather than a client's, so it can live in the
repository as the export fixture without redaction. Confirm that before committing it.

## Acceptance criteria

- [ ] Five documents entered by hand in a test Omega company: cash receipt, card purchase, received invoice, foreign-currency document, issued invoice
- [ ] A "Doklady EUD" TXT export produced from that company and stored as a fixture
- [x] The specification kept in the repository — `docs/reference/omega/ImportExport_28_00_2025.xls`
- [ ] The decimal separator read off the file and recorded
- [ ] Encoding confirmed as Windows-1250, separators as TAB, line endings as CRLF, dates as `DD.MM.RRRR`
- [ ] Whether a `>>` boundary row appears, recorded either way
- [ ] What Omega writes into the MD and DAL account fields of `R02`, and whether an empty pair is accepted on re-import
- [ ] The evidence code and number series recorded for each of the five documents (type codes are already known — see the amendment to ADR 0014)
- [ ] What Omega writes for foreign-currency rates, and what it does without a rate date
- [ ] Confirmed that the file holds no real client data before it is committed
- [ ] PRD open questions 1, 10, 13 and 14 updated

## Blocked by

None - can start immediately
