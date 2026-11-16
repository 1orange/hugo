# 11 — Advance deducted, amount due, references and manual override

Type: AFK
Status: done
User stories: 83–86, 90, 93

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Make the settlement visible and correctable. The advance-settlement result gains the advance deducted,
the amount due and the referenced advance document numbers (`ZDD15873826`, `Zálohové doklady č.
5926010455`), stored as new payload fields with an `advanceSettlement` flag and its source
(`detected` or `manual`).

For a settled invoice the fields panel shows *Odpočet zálohy* and *K úhrade* under *Sumy*, the
referenced advance documents, and the hint *Vyúčtovanie zálohy — k úhrade 0,00, účtuje sa plná suma*.
*total − advance = amount due* is checked as an additional, informational identity whose failure flags a
misread advance. The accountant can mark a document as settled or not settled; a manual flag wins over
detection (ADR 0010), survives re-reading, and recomputes the totals accordingly. The existing
*proforma* hint is unchanged.

## Acceptance criteria

- [ ] The corpus invoices show the advance deducted, the amount due and their advance document numbers.
- [ ] The hint appears only on settled invoices.
- [ ] An advance amount that breaks *total − advance = due* shows a warning; a consistent one shows none.
- [ ] Marking a document *not settled* restores the plain extraction; marking an undetected one *settled* applies the settlement rules; both survive re-reading.
- [ ] Unit tests cover the identity check and override in both directions; a fields-panel UI test covers the fields, hint and override.

## Blocked by

- 10 — Zálohové (preddavkové) faktúry keep their real values
