# 14 — Settings and company profiles

Type: AFK
User stories: 4, 5, 6, 7, 8, 9, 10

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Makes editable what earlier slices seeded as constants. Nothing new conceptually — this slice moves
configuration out of code and into her hands.

Global settings: the canonical folder list (used for matching, repair proposals and scaffolding),
the movable-folder list, and the Drive parent folder id. The movable list defaults to `02`, `04`,
`05`, `06` — a filing convention rather than a law, which is why it belongs in settings and not in
a conditional (ADR 0006).

Per-company profile: display name, active flag, folder-template override so a client with no
employees does not carry an empty `07 Mzdy` every month, and the encrypted bank statement password.

The password is encrypted with a key held in the environment, never in the database, so a leaked
backup does not leak passwords. She is prompted for a new one **only when decryption actually
fails** — banks rotate them — and never otherwise.

Marking a company inactive removes it from the work list without deleting history.

Editing the canonical list has teeth: a wrong entry makes existing folders look unrecognised, so the
UI must show the impact of a change before it is saved.

## Acceptance criteria

- [ ] Canonical folder list is editable and immediately affects matching, repair proposals and scaffolding
- [ ] Editing the canonical list previews how many existing folders would become unrecognised before saving
- [ ] Movable-folder list is editable and drives `LateArrivals` rather than a hardcoded set
- [ ] Per-company folder template override is honoured when scaffolding a month
- [ ] Statement password can be set per company and is stored encrypted
- [ ] The raw database file does not contain any password plaintext
- [ ] A rotated password prompts once on decryption failure, saves, and retries successfully
- [ ] A successful decryption never prompts
- [ ] Marking a company inactive removes it from the work list and retains its history
- [ ] The scaffolding template in effect is visible before it is applied
- [ ] Integration test: change the movable list, verify a previously-proposed move becomes a warning

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
- 08 — Statement decrypt, parse and reconcile
