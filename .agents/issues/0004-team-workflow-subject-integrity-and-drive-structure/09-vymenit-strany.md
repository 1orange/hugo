# 09 — *Vymeniť strany*

Type: AFK
Status: done
User stories: 14–23

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

A *Vymeniť strany* button between the *Dodávateľ* and *Odberateľ* fieldsets swaps the two parties
wholesale. A pure party-swap module exchanges name, IČO, DIČ and IČ DPH together with their provenance;
swapping twice restores the original exactly. The result is saved through the confirmed-values path,
so it outranks extraction and survives draft rebasing (ADR 0010). Provenance badges move with the
values. Roles stay derived from the profile at read time (ADR 0018), so role warnings recompute
immediately. A `PartiesSwapped` user event is appended and shown in the activity log. The button has a
keyboard shortcut consistent with the workbench's single-key shortcuts, is available on every document
that shows both parties, and is disabled whenever the fields are read-only (decided, exported, closed
month).

## Acceptance criteria

- [ ] One click moves all eight fields and their provenance badges to the opposite side; a second click restores them.
- [ ] The swap persists across reload and draft rebasing.
- [ ] Role warnings reflect the swapped values immediately.
- [ ] `PartiesSwapped` appears in the activity log.
- [ ] The shortcut triggers the swap; the button and shortcut do nothing on read-only documents.
- [ ] Unit tests cover the involution, all fields, provenance and empty sides; a fields-panel UI test covers enabled/disabled states and warnings; the invoice-fields Playwright spec covers a swap.

## Blocked by

None - can start immediately
