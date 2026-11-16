# 07 — Structure check at company level

Type: AFK
Status: ready-for-agent
User stories: 68, 69, 73–76, 80

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Extend the drive-structure module and the structure view upward to the company folder:

- ~~`company-prefix-missing`~~ — dropped: the office reads level 2 by depth ("every folder at level 2,
  without exception"), so a client folder's name is not checked;
- `month-missing` — the current month's folder is absent for a client outside the archive (the office's
  script creates it nightly from 2027-01-01, so a missing one is a failed script run);
- `month-duplicate` — two folders parse to the same month key;
- ~~`month-not-archived`~~ — dropped: older months stay beside the new ones and are not moved;
- `folder-unrecognised` — an unknown folder at company level;
- `file-misplaced` — a file directly in the company folder or in an archive-year folder.

Past-year archive folders (`YYYY`) are accepted and not descended into, unless slice 05 decided
otherwise. Month-root files stay allowed (VAT outputs). The company prefix and the expectation of
twelve pre-created months are global settings. All kinds appear on the existing badge, count and
structure view.

## Acceptance criteria

- [ ] Each kind is produced by exactly one mutation of the snapshot and by nothing else.
- [ ] At a year rollover, a company without the new year shows one `year-missing` deviation.
- [ ] Archive-year folders produce no deviations from their contents, per slice 05's outcome.
- [ ] Changing the prefix setting changes `company-prefix-missing` results without a deploy.
- [ ] Root-level folders slice 05 declared non-client are handled as decided.
- [ ] Table-driven unit tests cover every kind and the rollover; the structure view shows company-level deviations.

## Blocked by

- 04 — Company name shown and searched without `Konto `
- 05 — Confirm the live Drive layout before checking it
- 06 — Structure check inside months, on *Firmy* and a structure view
