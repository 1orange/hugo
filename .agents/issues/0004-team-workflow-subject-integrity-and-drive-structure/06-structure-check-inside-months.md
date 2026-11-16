# 06 — Structure check inside months, on *Firmy* and a structure view

Type: AFK
Status: done
User stories: 66, 67, 70–72, 77–79

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The tracer bullet for *Štruktúra Drive*. A pure drive-structure module checks one company's
current-year month folders against the canonical subfolder list and returns deviations, each with a
kind, a Drive path, a severity and, where applicable, the existing rename proposal. This slice covers
the month-level kinds:

- `subfolder-missing` — a current-year month lacks a canonical subfolder;
- `subfolder-repair` — a near-miss name, carrying the existing ADR 0007 rename proposal;
- `folder-unrecognised` — an unknown folder inside a month (`04 Pokladňa`).

The sweep computes deviations from the tree it already builds and replaces each company's stored
deviations wholesale, so a fix in Drive clears them on the next sweep. *Firmy* shows a badge with the
count on each affected company, linking to a new per-company structure view that lists deviations in
plain Slovak with their Drive path and what to do; repairs are confirmed from there through the
existing propose/confirm/undo flow. The summary strip gains *odchýlky štruktúry*. The month screen's
folder-repair panel links to the structure view. Companies without a profile are checked too.

## Acceptance criteria

- [ ] The snapshot in `.agents/ctx/gdrive/structure` produces zero deviations.
- [ ] Removing, misspelling or adding a subfolder in one month yields exactly one deviation of the right kind with its path.
- [ ] NFD folder names never produce deviations on their own.
- [ ] Deviations are stored per company and replaced on each sweep; fixing the fake Drive and sweeping clears them.
- [ ] *Firmy* shows the badge and count, the summary strip counts companies with deviations, and the structure view lists them.
- [ ] A near-miss repair can be confirmed and undone from the structure view.
- [ ] Table-driven unit tests start from the snapshot and apply one mutation per kind; a sweep integration test and a UI test cover storage and display.

## Blocked by

- 02 — Hugo stops creating folders
- 03 — The office's folder names become the defaults
