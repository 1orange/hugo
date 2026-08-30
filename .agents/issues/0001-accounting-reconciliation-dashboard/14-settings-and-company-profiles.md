# 14 — Settings and company profiles

Type: AFK
User stories: 4, 5, 6, 7, 8

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Makes editable what earlier slices seeded as constants. Nothing new conceptually — this slice moves
configuration out of code and into her hands.

Global settings: the canonical folder list (used for matching, repair proposals and scaffolding),
the movable-folder list, and the Drive parent folder id. The movable list defaults to `02`, `04`,
`05`, `06` — a filing convention rather than a law, which is why it belongs in settings and not in
a conditional (ADR 0006).

Per-company profile: display name, active flag, and a folder-template override so a client with no
employees does not carry an empty `07 Mzdy` every month.

Marking a company inactive removes it from the work list without deleting history.

Editing the canonical list has teeth: a wrong entry makes existing folders look unrecognised, so the
UI must show the impact of a change before it is saved.

> **Amended, 2026-08-30.** The per-company profile also held **the encrypted bank statement
> password**, prompted for only when decryption actually failed, with its encryption key kept in the
> environment rather than in the database. That is gone: the app never opens a statement, so there
> is no password to hold and no key to manage (ADR 0013, ADR 0009 withdrawn, ADR 0004 amended). It
> takes the two user stories that covered it with it, and it removes the last secret from the
> database — which is worth more than the feature was.

## Status

Global settings (14a) are **done**: canonical list, movable list and Drive parent folder id are
editable at `/settings`, validated and NFC-normalised on save, with an impact preview and settings
domain events. See the amendment in ADR 0007.

Per-company profiles (14b) remain. They are no longer blocked on anything, because what blocked
them was slice 08.

## Acceptance criteria

- [x] Canonical folder list is editable and immediately affects matching, repair proposals and scaffolding
- [x] Editing the canonical list previews how many existing folders would become unrecognised before saving,
      and how many would become recognised
- [x] Movable-folder list is editable and stored; wiring it into `LateArrivals` belongs to slice 13
- [ ] Per-company folder template override is honoured when scaffolding a month
- [ ] Marking a company inactive removes it from the work list and retains its history
- [ ] The scaffolding template in effect is visible before it is applied
- [ ] No settings surface asks for, stores or displays a bank statement password
- [ ] Integration test: change the movable list, verify a previously-proposed move becomes a warning

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
