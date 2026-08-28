# ADR 0006 — Drive mutations are proposed, recorded and reversible

Date: 2026-08-28
Status: Accepted

## Context

The app writes into Drive in three ways: moving late-arriving documents into the open month,
renaming misnamed folders, and creating month folders.

These files and folders are her clients' financial records, held under a 10-year retention
obligation. Drive has no application-level undo. A wrong rule applied silently across every client
at once is the failure mode that ends the project's credibility.

Separately, the move rule cannot be uniform across folders. A late `02 Prijaté faktúry` moving from
May to July is correct — the VAT deduction is legitimately claimed in a later period. The same
move applied to `03 Bankové výpisy` is corruption: a May statement is May's. `07 Mzdy` belongs to
its period. Moving `01 Vystavené faktúry` shifts revenue into the wrong month.

## Decision

**Every Drive mutation is proposed, not performed.** Detected changes are queued; she confirms
them in a batch per company; each applied mutation is written to `drive_mutations` with the
previous parent and previous name, which makes undo a single click rather than a reconstruction.

Late arrivals are a **persistent log**, not a transient proposal list, with status
`pending | moved | ignored | resolved`. Nothing can be lost by navigating away.

Which folders are movable is **configuration, not code**. The default value is
`02 Prijaté faktúry`, `04 Bločky_hotovosť`, `05 Bločky_firemná karta`, `06 Iné doklady`. Folders
`01`, `03` and `07` are excluded by default and a late arrival there raises a warning instead of a
proposal.

Because only files inside the numbered folders are considered, the VAT output PDFs at the month
root are protected for free.

Before any mutation the relevant Drive `capabilities` field is checked
(`canMoveItemWithinDrive`, `canRename`) and the app refuses with an explanation rather than
attempting and failing.

If the destination folder slot does not exist in the open month, it is created with the canonical
name.

## Consequences

- Confirmation costs her roughly one click per company per month. A silent mistake costs trust.
- `drive_mutations` is a real table with a purpose, not an audit afterthought — undo reads from it.
- Batch confirmation means one decision covers many files, so the friction does not scale with
  volume.
- The movable-folder list being configurable means a change to her filing convention is a settings
  edit, not a deploy.
- Folder renames are safe in a way moves are not: **Drive renames preserve file IDs**, so client
  links, shortcuts and permissions all survive. This is what makes the one-time name repair in
  ADR 0007 acceptable.

## Alternatives considered

- **Fully automatic with a log and undo.** Faster for her, but applies a rule to client data
  before anyone has looked at it.
- **Automatic after a trust period.** Defers the risk rather than removing it, and the trigger for
  flipping the switch would be arbitrary.
- **Confirm each file individually.** Safe but tedious; batch confirmation with undo achieves the
  same safety.
- **Hardcoding the movable folder list.** Correct today, but it is a filing convention rather than
  a law, and it belongs in settings.
