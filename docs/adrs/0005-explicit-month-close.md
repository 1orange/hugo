# ADR 0005 — Explicit month close as the lifecycle anchor

Date: 2026-08-28
Status: Accepted

## Context

Several features depend on knowing whether a month is still being worked on: the open-month view,
the late-arrival rule, the destination for a moved document, and folder scaffolding for the next
month.

Three heuristics were considered and each fails on real data.

Presence of the VAT return PDF at the month root looked promising — until the sample was checked.
**All seven months** in the spring folder already contain `Daňové priznanie DPH.pdf`, so the rule
"missing VAT return means open" reports zero open months. `2026_07` even carries it under the
mangled name `Daňové priznanie.DPHpdf.pdf`.

A calendar rule (month N closes after the VAT deadline on the 25th of N+1) encodes an assumption
about when she actually files, which varies per client and per workload.

"Newest folder is open" breaks the moment folders are scaffolded ahead of time — which this design
does deliberately.

## Decision

The month lifecycle is anchored on an **explicit action**: she clicks *Close month* per company.
That writes `closedAt` on the month record.

Everything derives from that single timestamp:

- The open month is the most recent month without a `closedAt`.
- A document is a late arrival when its Drive `createdTime` is after `closedAt` for the month
  folder it sits in.
- The move destination for a late arrival is the open month, same folder slot.
- Closing month N scaffolds the folders for month N+1.

The canonical cycle is: collect → extract → pair → tick → export → import into Omega → file DPH →
close.

Reopening a closed month is supported, because a misclick should not be permanent.

## Consequences

- One deliberate click per company per month, replacing a heuristic guessing at her filing habits.
- Historical months are read-only by virtue of being closed. No separate permission concept.
- `closedAt` is load-bearing for a Drive mutation, so the close action must be recorded in the
  event log like any other consequential action.
- Late detection needs a fallback: a client copying a file can produce an implausible
  `createdTime`, so `firstSeenAt` from the sweep is used when `createdTime` is not trustworthy.
- Quarterly VAT payers need no special handling. The folders are monthly regardless and the VAT
  period is Omega's concern.

## Alternatives considered

- **Presence of the VAT return PDF.** Disproved by the sample — every month has one.
- **Calendar rule tied to the VAT deadline.** Encodes an assumption about her schedule that does
  not hold across clients.
- **Newest month folder is open.** Incompatible with scaffolding months ahead.
