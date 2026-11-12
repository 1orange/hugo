# 04 — Company name shown and searched without `Konto `

Type: AFK
Status: done
User stories: 63, 64

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Every company folder is named `Konto <company>`. The prefix belongs to the Drive convention, not to the
company (ADR 0007 amendment). A pure display-name function strips a leading `Konto ` (case-insensitive,
after NFC normalisation, surrounding whitespace trimmed) and is used wherever Hugo shows a company name:
*Firmy*, breadcrumbs, month and activity screens, profile page. Profile setup searches RPO/ARES by the
display name, so register search finds the company. The stored Drive name is unchanged, and a folder
without the prefix is shown as it is.

## Acceptance criteria

- [ ] `Konto SPRING.etc.` is shown as `SPRING.etc.` on every screen that names the company.
- [ ] Profile setup pre-fills and searches the register with the name without the prefix.
- [ ] `konto`, `KONTO`, NFD input and extra spaces are handled; `Kontohaus s.r.o.` (no separating space) is not stripped.
- [ ] The stored company name and Drive folder are unchanged.
- [ ] Unit tests cover the function's cases; the company-profile Playwright spec covers search with a prefixed folder.

## Blocked by

None - can start immediately
