# 09 — Benchmark fixtures and scoring from Omega's outputs

Type: AFK
Status: ready-for-agent
User stories: 43

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The ruler every model is measured with (ADR 0017), built from what she actually booked rather than
from labels anyone drafts. It replaces PRD 0001 slice 10.

End to end: a label-import script reads two Omega outputs and writes private fixtures keyed by
Drive file:

- her **`T01` export** — `docs/reference/omega/eport OF .txt`, whose six `spring` May rows match the
  six PDFs in `2026_05/01` on number, VS, all three dates, customer IČO, base, VAT and total;
- the **VAT-deduction register** PDF (*evidencia DPH – Odpočítanie dane*) in the month folder, whose
  lines give the supplier's document number, date, supplier IČ DPH, KV DPH section, and base and VAT
  per rate — 11 of the 16 received-side documents for `spring` May.

`BenchmarkScoring` compares a payload with a label under two rules: documents in KV DPH section `B1`
(reverse charge and intra-EU — Kaspersky and Bonami) are scored on **base only**, because the
register shows VAT she self-assessed; **receipt dates are not scored**, because she books by her own
date (Zamkni: printed 30.04.2026, booked 01.05.2026).

A harness command runs any `Extractor` implementation over the fixtures — a stub in this slice —
and reports per-field exact match, the check-state distribution, the ADR 0017 adoption bar and the
median time per document. It runs on demand and never in the normal test suite. It starts with the
17 `spring` May documents; the other five are added when she exports *Doklady EUD*.

## Acceptance criteria

- [ ] The label-import script turns a `T01` export and a VAT-register PDF into fixtures keyed by Drive file, written to the private-fixtures directory
- [ ] The six `spring` May issued invoices and eleven received documents are labelled
- [ ] `BenchmarkScoring` scores `B1` documents on base only and does not score receipt dates, with unit tests on synthetic labels
- [ ] The harness runs a stub `Extractor` over the fixtures and prints per-field match, check states, the adoption bar result and median time
- [ ] The harness is not part of `node --test`, and fails with a clear message when the private fixtures are absent
- [ ] Nothing in the fixtures or the report is committed outside the private directory

## Blocked by

- 06 — Invoice fields and derived roles
