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

## Amendment, 2026-11-11 — the office creates the folders; future months are dormant (PRD 0004)

The office now pre-creates every client's twelve month folders, each with its seven subfolders, at
the start of the year. Two parts of this ADR assumed Hugo did that work:

- **"Closing month N scaffolds the folders for month N+1"** is withdrawn. Closing a month writes
  `closedAt`, records `MonthClosed`, and does nothing in Drive. A missing folder for month N+1 is
  reported by the structure check (PRD 0004) rather than created.
- **"The open month is the most recent month without a `closedAt`"** fails exactly as the rejected
  "newest folder is open" heuristic did: with `2026_01` … `2026_12` present, December would be open in
  November. The open month is now **the most recent month without a `closedAt` whose key is not after
  the current calendar month** (Europe/Bratislava). Months after the current month are *future
  months*: swept and stored, hidden from month pickers and from the open-month rule until they start.
  A document a client uploads into a future month is shown there once it starts, and noted on the
  open month in the meantime; it is never moved.

Late detection, reopening and the canonical cycle are unchanged. Month rows that older scaffolding
created ahead of time need no migration — they become future months under the new rule.

## Amendment, 2026-11-12 — lateness is judged on arrival, the destination is the current month

Late arrivals are now built (PRD 0004 issue 19). Two points of the decision change:

- **"A document is a late arrival when its Drive `createdTime` is after `closedAt`"** is replaced by:
  a file is late when it **arrived in its month after `closedAt`**, arrival being Hugo's own clock —
  the sweep that first saw it there, or the sweep that saw it moved there from another month (stored
  as `files.arrived_at`; null means "since first seen"). `createdTime` was the untrustworthy part the
  consequences already worried about, and it missed two real cases: a file uploaded just before the
  close but swept after it, and an old file a client moves into a closed month. A move between
  folders of one month is not an arrival.
- **The destination is the open month**, which by the 2026-11-11 rule is the current calendar month
  whenever its folder exists and is not closed; only when the current month is missing or closed is
  it the newest unclosed month before it. Older months left unclosed stay editable but are not the
  destination.

Reopening a month resolves the late arrivals still pending in it: they are in an open month again.
