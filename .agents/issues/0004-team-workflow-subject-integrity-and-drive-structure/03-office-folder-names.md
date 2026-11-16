# 03 — The office's folder names become the defaults

Type: AFK
Status: done
User stories: 65

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Adopt the office's agreed subfolder names (ADR 0007 and ADR 0006 amendments, 2026-11-11). The default
canonical list becomes `01 Vystavené faktúry`, `02 Prijaté faktúry`, `03 Bankové výpisy`,
`04 Platby hotovosťou`, `05 Platby kartou`, `06 Iné doklady`, `07 Mzdy`; the default movable list
becomes `02 Prijaté faktúry`, `04 Platby hotovosťou`, `05 Platby kartou`, `06 Iné doklady`.

A data migration replaces a stored list only when it still equals the old default; customised lists
are left alone. The existing settings impact preview shows what any change does. Code that names
`Bločky` literally is updated; code that identifies a folder by its two-digit number keeps working.
Folders still carrying the old names are *unrecognised* (not repair candidates), which is intended.

## Acceptance criteria

- [ ] A fresh install uses the new canonical and movable lists.
- [ ] The migration updates stored lists equal to the old defaults and leaves customised lists untouched; it is idempotent.
- [ ] Folders named per the snapshot in `.agents/ctx/gdrive/structure` classify as canonical, including NFD-encoded names.
- [ ] `04 Bločky_hotovosť` classifies as unrecognised under the new list, and the impact preview reports it.
- [ ] No source outside tests and ADRs refers to the old names.
- [ ] Unit tests cover classification under the new defaults and the migration rule; the settings impact-preview tests pass.

## Blocked by

None - can start immediately
