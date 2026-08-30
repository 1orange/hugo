# 21 — Chase dashboard, the company list as landing screen

Type: AFK
User stories: 3, 43

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The screen that answers both of her daily questions at once: whom to chase, and what is left to
process. Today those answers cost seven Drive folders opened one at a time.

The company list becomes the landing dashboard. One row per active company, showing for the open
month:

- **Statement present** — from slice 20, with the arrival date.
- **Proofs arrived** — how many documents are in the processed folders `01`, `02`, `04`, `05`, `06`.
- **Documents left to process** — the count awaiting her decision, which reaches zero when every
  document is confirmed or marked not relevant (ADR 0010's amendment). This is the number the whole
  screen rests on, which is why it must be able to reach zero.
- **Last client upload** — the most recent arrival anywhere in the company's open month, including
  `03`, because "nothing since the 3rd" is the chase signal.

Plus the stage indicator from slice 05, on the corrected cycle: collect → extract → decide →
export → close.

Everything here is **presence information**. There is no expected-document model, no per-company
expected account count, and no notion of what *should* have arrived — the app reports what did.
And there are **no automated emails or messages to clients**: she does the pinging, with her own
wording. Those are out of scope in the PRD deliberately rather than by omission.

The counts are queries over `files` and `documents`, both already keyed by company and month. No
new table, and no denormalised counters — at 5–15 companies and low hundreds of documents a month
the aggregate is trivial, and a cached count that drifts is worse than no count. If it ever becomes
slow, a generated column is the upgrade path (ADR 0004).

An inactive company does not appear. A company with no open month shows as idle rather than as a
row of dashes.

## Acceptance criteria

- [ ] The company list is the landing route after sign-in
- [ ] Each row shows statement presence with its arrival date, or an explicit "no statement yet"
- [ ] Each row shows how many proofs arrived in the processed folders for the open month
- [ ] Each row shows how many documents await her decision
- [ ] The awaiting count reaches zero when every document is confirmed or marked not relevant
- [ ] Each row shows the last client upload time across the whole open month, `03` included
- [ ] A company with no uploads at all this month is visibly distinct from one that is simply finished
- [ ] Inactive companies are absent; a company with no open month reads as idle
- [ ] The stage indicator no longer offers a `pair` stage
- [ ] No expected-document count, no target, and no send-a-reminder action appears anywhere on the screen
- [ ] Clicking a row opens that company's open-month document screen
- [ ] Integration test: a seeded company with one statement, five proofs and two decisions renders the expected four figures
- [ ] E2E: confirm the last awaiting document and watch the row's remaining count reach zero

## Blocked by

- 20 — Bank statement presence
- 22 — Document screen and schema
