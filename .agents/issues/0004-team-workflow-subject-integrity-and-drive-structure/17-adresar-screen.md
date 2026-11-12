# 17 — *Adresár* screen

Type: AFK
Status: done
User stories: 48–51

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

A top-level *Adresár* screen, following the Slovak workbench conventions of ADR 0015. It lists directory
subjects with normalised search by name, alias, IČO, DIČ and IČ DPH, and shows each subject's verdict,
register and VIES status, value sources, `verifiedAt`, and the companies and documents that reference
it. An accountant can correct a subject's fields; a corrected field is marked `manual`, shows its source,
is never overwritten by a register refresh, and a fresh register answer that disagrees becomes a finding
on the subject. Corrections are recorded in the event log, and documents referencing the subject show
the corrected values through the directory on next view.

## Acceptance criteria

- [ ] Searching by any of name, alias, IČO, DIČ or IČ DPH finds the subject, ignoring case and diacritics.
- [ ] A subject's page lists referencing companies and documents.
- [ ] A manual correction persists, shows *manual*, survives a refresh, and a disagreeing refresh shows a finding.
- [ ] Corrections appear in the activity log.
- [ ] Unit tests cover search normalisation; integration tests cover manual protection against refresh; a Playwright test covers searching and correcting a subject.

## Blocked by

- 13 — Subject directory, with name and DIČ verified against the registers
