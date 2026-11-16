# 16 — Integrity problems in the document rail and the export

Type: AFK
Status: done
User stories: 41, 42

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Surface stored integrity verdicts beyond the open document. A document with any party `mismatch` gets a
warning marker on its document-rail row, and the rail can be narrowed to such documents through the
existing search/filter. Before an Omega export, the export panel lists the documents whose parties
failed integrity, with links; the export is not blocked. Notices and `unverifiable` do not mark rows.

## Acceptance criteria

- [ ] A document with a mismatched party shows a rail marker; notices and unverifiable parties do not.
- [ ] The rail can show only documents with integrity problems.
- [ ] The export panel lists affected documents before export and still allows exporting.
- [ ] Unit tests cover the document-browser projection with verdicts; a UI or Playwright test covers the marker and the export warning.

## Blocked by

- 12 — Offline subject checks on every party
