# 10 — Zálohové (preddavkové) faktúry keep their real values

Type: AFK
Status: done
User stories: 81, 82, 87–89, 91, 92, 94, 95

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

An invoice from which a paid advance is deducted prints an amount due of `0,00`; the accountant books
the value of the supply (ADR 0017 amendment, 2026-11-11). A pure advance-settlement module runs
deterministically on the reading-order text lines and the extracted payload, after the model and before
PRD 0003's enrichment and VAT derivation.

It detects a settlement only when **both** a deduction label (`Zál. daň. dokl.`, `odpočet zálohy`,
`uhradené zálohou`, `celkom uhradených záloh`, `zálohy celkom`, `preddavok`, folded for case and
diacritics) **and** non-zero supply rows or a non-zero printed gross total are present. Recap rows
carrying a deduction marker, or negative rows exactly cancelling a supply row of the same rate, become
settlement rows: kept in the payload for audit, excluded from *DPH podľa sadzby* and from every derived
aggregate. The total is a grounded printed gross total equal to the supply rows' base + VAT (within cash
rounding), otherwise base + VAT of the supply rows with provenance `derived`. A zero total with non-zero
supply rows is never accepted.

The arithmetic check compares base + VAT with the supply total and accepts a zero amount due. PRD
0003's single-rate VAT inference is skipped on settled invoices. The Omega export carries the supply
values. Works for issued and received invoices. The model schema is unchanged; the extraction pipeline
version is bumped so undecided documents in open months are re-read, with PRD 0003's protection of
decided, exported and closed-month documents.

## Acceptance criteria

- [ ] The three settled invoices in the private benchmark corpus yield their supply total, base and VAT: negative `Zál. daň. dokl.` rows at 0 % (43,89) and 23 % (32,51 + 7,48 = 39,99), and the full recap 364,65 + 83,87 = 448,52 with `k úhrade 0,00`.
- [ ] Settlement rows never appear in *DPH podľa sadzby* or in derived VAT totals.
- [ ] A printed gross total gets `extracted` provenance; a sum of supply rows gets `derived` and shows *vypočítané*.
- [ ] A zero total without a deduction label is not treated as a settlement and is flagged as before.
- [ ] Credit notes (negative supply) are not settlements; single-rate VAT inference never runs on a settlement.
- [ ] The Omega export of a settled invoice carries the supply values.
- [ ] After the pipeline bump, an undecided settled invoice in an open month is re-read; decided and closed ones are untouched.
- [ ] Benchmark fixture labels for the three corpus invoices are added; table-driven unit tests cover the corpus cases and synthetic ones (partial advance, several rates with one cancelled, disagreeing gross total, cash rounding, Czech labels); integration tests cover the VAT derivation and export.

## Blocked by

None - can start immediately
