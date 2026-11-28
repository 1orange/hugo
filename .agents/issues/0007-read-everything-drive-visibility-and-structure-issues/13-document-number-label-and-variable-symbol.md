# 13 — *Číslo dokladu KV DPH*, and the variable symbol filled from the document number

Type: AFK
Status: done

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

- [x] Derivation unit tests: `SK-26001` → `26001`; `FA2026/0012` → `20260012`; a number with no digits → empty and flagged; 11 digits → empty and flagged; an extracted VS kept; a typed VS kept after a number edit; a derived VS follows a number edit. (`tests/unit/modules/document-fields.test.ts`; the save-and-reload path in `tests/unit/documents/documents-integration.test.ts`.)
- [x] The workbench shows *Číslo dokladu KV DPH* and a derived VS with its provenance mark (UI test). Verified: `tests/ui/fields-panel-variable-symbol.spec.ts` passes in the UI run ("the document number is labelled KV DPH…", "a derived symbol follows an edit to the document number", "a symbol she types stays…"). The X-key case in `fields-panel-swap.spec.ts` was fixed to clear the derived symbol first.
- [x] The export writes the digits-only VS when the field is empty, and holds back a document whose number yields none (export tests). (`tests/unit/omega-export/omega-export-integration.test.ts`.)

## Blocked by

None - can start immediately
