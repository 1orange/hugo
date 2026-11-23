# 13 — *Číslo dokladu KV DPH*, and the variable symbol filled from the document number

Type: AFK
Status: ready-for-agent

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

- **Label.** The workbench field *Číslo dokladu* becomes **Číslo dokladu KV DPH**. The field, its
  storage and its export column don't change.
- **Variable symbol derivation** (in the document fields merge, pure). When the variable symbol is
  empty after extraction and confirmation, its value is the document number's digits (all non-digits
  removed), with provenance `derived`, if that leaves 1–10 digits. Otherwise it stays empty and the
  existing missing-value flag shows.
  - A printed or extracted VS is never replaced.
  - A derived VS follows when the accountant edits the document number.
  - Once the accountant types a VS (`confirmed`), it stops following, as other derived fields do
    (PRD 0003).
  - The field shows its derived provenance like other derived values.
- **Omega export.** The fallback "VS empty → document number" uses the same digits-only derivation, so
  a raw number like `SK-26001` is never written as a VS. A document whose number yields no valid VS is
  held back with the existing reason.

## Acceptance criteria

- [ ] Derivation unit tests: `SK-26001` → `26001`; `FA2026/0012` → `20260012`; a number with no digits → empty and flagged; 11 digits → empty and flagged; an extracted VS kept; a typed VS kept after a number edit; a derived VS follows a number edit.
- [ ] The workbench shows *Číslo dokladu KV DPH* and a derived VS with its provenance mark (UI test).
- [ ] The export writes the digits-only VS when the field is empty, and holds back a document whose number yields none (export tests).

## Blocked by

None - can start immediately
