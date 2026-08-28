# 13 — Late arrivals log and move proposals

Type: AFK
User stories: 55, 56, 57, 58, 59, 60, 61, 62

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The feature that stops a late upload from being lost, and the one that carries the most risk to
trust because it relocates her clients' files.

`LateArrivals` is a pure module: given files in a closed month, that month's `closedAt`, and the
movable-folder settings, it returns move proposals and non-movable warnings. Detection is
`createdTime > closedAt`, with `firstSeenAt` from the sweep as a fallback when Drive reports an
implausible creation time — client copies produce these.

The rule is **not uniform across folders**, per ADR 0006. A late `02 Prijaté faktúry` moving from
May to July is correct, because the VAT deduction is legitimately claimed in the later period. The
same move applied to `03 Bankové výpisy` is corruption — a May statement is May's. `07 Mzdy`
belongs to its period, and moving `01 Vystavené faktúry` shifts revenue into the wrong month.
Default movable set: `02`, `04`, `05`, `06`. A late arrival in `01`, `03` or `07` raises a warning
and no proposal.

Because only files inside the numbered folders are considered, the month-root VAT output PDFs are
protected for free.

Late arrivals are a **persistent log** with status `pending | moved | ignored | resolved`, not a
transient list she can lose by navigating away. Moves are proposed, confirmed in a batch per
company, applied through the machinery from slice 04, recorded in `drive_mutations` with the source
parent, and undoable.

Destination is the open month, same folder slot, created with the canonical name if absent.

## Acceptance criteria

- [ ] A file created after `closedAt` in a movable folder yields a proposal targeting the open month, same folder slot
- [ ] The same file in `03` or `07` yields a warning and no proposal
- [ ] A file created before `closedAt` yields nothing
- [ ] The `firstSeenAt` fallback triggers when `createdTime` is implausible
- [ ] Month-root VAT PDFs never appear as late arrivals
- [ ] Every late arrival is logged with a status and survives a reload
- [ ] Status can be set to ignored or resolved, and an ignored arrival stays off the active list
- [ ] Batch confirmation moves all pending proposals for a company in one action
- [ ] Each applied move writes a `drive_mutations` row containing the source parent
- [ ] Undo returns the file to its original parent and marks the mutation undone
- [ ] A file reporting `canMoveItemWithinDrive: false` is not moved and surfaces an explanatory warning
- [ ] A missing destination folder is created with the canonical name rather than failing the move
- [ ] A moved file retains its extraction, pairings and tick — file-ID keying proven again
- [ ] `Moved` events emitted for both the move and the undo
- [ ] E2E: confirm a batch, then undo one move

## Blocked by

- 04 — Unrecognised folder detection and rename repair
- 05 — Month close, reopen and folder scaffolding

## Notes

If slice 02 found `canMoveItemWithinDrive` to be false on real client-uploaded files, this slice
needs redesigning before implementation, not during.
