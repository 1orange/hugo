# 04 — Unrecognised folder detection and rename repair

Type: AFK
User stories: 18, 19, 20

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The first write into her clients' Drive, chosen deliberately to be the safest one. This slice's
real deliverable is the **propose → confirm → record → undo machinery** that slices 05 and 13
reuse; folder repair is the excuse to build it.

Because matching is on exact canonical names (ADR 0007), a typo hides a folder's contents. The
sweep already classifies non-canonical folders as repair-candidates; this slice surfaces them and
lets her fix them.

A repair is proposed, never performed automatically. She confirms, the rename is applied, and the
mutation is recorded in `drive_mutations` with the previous parent and previous name, which is what
makes undo a single click rather than a reconstruction. Every applied and undone mutation emits an
event.

Before attempting anything, the relevant Drive `capabilities` field is checked and the app refuses
with an explanation rather than attempting and failing.

The UI should state plainly that renaming a folder does not break her clients' links, because Drive
renames preserve file IDs. She needs to believe that before she will click the button.

## Acceptance criteria

- [ ] Non-canonical folders appear as unrecognised in the month view rather than being omitted
- [ ] Each unrecognised folder offers a proposed canonical name, never applied without confirmation
- [ ] Confirming a repair renames the folder in Drive and the month view immediately reflects it
- [ ] Every applied rename writes a `drive_mutations` row containing the previous name
- [ ] Undo restores the previous name and marks the mutation undone rather than deleting the row
- [ ] A folder reporting `canRename: false` is not attempted and surfaces an explanatory warning
- [ ] Documents inside a repaired folder keep their existing status, extraction and pairings — proving file-ID keying works
- [ ] `Renamed` events are emitted for both the rename and the undo
- [ ] Integration test: propose, confirm, verify against the fake Drive adapter, undo, verify restoration and event order

## Blocked by

- 02 — Provision Drive access
- 03 — Drive sweep to company and month tree, read-only
