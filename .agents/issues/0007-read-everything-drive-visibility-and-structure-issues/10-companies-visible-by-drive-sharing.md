# 10 — Each person sees only the companies shared with them in Drive

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

Make the issue 08 rule a real restriction, enforced on the server. Drive is the single source of truth
for who sees which company.

- **One guard**: "companies visible to this session", from the access snapshot and the signed-in email.
  It is one database query, not a Drive call. Used by:
  - the company list and its summary counts;
  - every company route: month, profile, structure, activity;
  - every server action that takes a company or document id;
  - the Omega export.
  An invisible company answers as not found.
- **Allowlist unchanged**: it still decides who may sign in (ADR 0011). Drive access never admits
  anyone.
- **Office-wide screens stay office-wide**: Adresár and Settings.
- **Empty state.** With no visible company: *Nemáš prístup k žiadnej firme v Drive — požiadaj o
  zdieľanie priečinka klienta.* Before any snapshot exists: *Načítavam prístupy z Drive…*. Hugo fails
  closed.
- **Remove *Moje firmy***: the per-browser assignment module, its toggle, its storage handling and its
  e2e spec. The group chips stay, shown only when the visible companies span more than one group.
- Write **ADR 0023**, "Company visibility follows Drive sharing". It supersedes ADR 0011's 2026-11-11
  amendment (personal filter, not a permission).
- Release only after issue 09 is approved by the office.

## Acceptance criteria

- [x] With two signed-in users and fake Drive permissions, each sees only their companies on *Firmy*, and the summary counts only theirs (e2e, replacing the *Moje firmy* spec). Verified: `tests/e2e/company-visibility.spec.ts` passes in the e2e run (26/26). Beta is shared with `allowed@example.com` only, Gamma is shared with the same user too, and Zeta is group-only, so nobody sees it.
- [x] Opening another user's company's month, profile, structure or activity URL returns not found. A server action on its document is refused (integration tests). Note: the action refusal is an integration test (`companyRefusalFor`); the page 404s are verified by the e2e test "a company another person cannot see answers not found…" (passes in the e2e run, 26/26).
- [ ] The Omega export refuses an invisible company. Note: both export actions call the guard; no test calls the action itself (it needs a session), so this rests on the code and the review.
- [x] No snapshot: an empty list with the loading message, never all companies. (`tests/unit/access/visibility-integration.test.ts`, "before the first read"; the page branch is read, not run.)
- [x] Group chips appear only when visible companies span more than one group. Note: the rule is in `company-table.tsx` (`groups.length > 1`); verified by `tests/ui/company-table.spec.ts` ("group chips appear only when the visible companies span more than one group"), which passes in the UI run.
- [x] *Moje firmy* code, UI and tests are removed. Lint and type checks pass. Note: `tsc` is clean; `lint:async` reports only the 10 pre-existing errors.
- [x] ADR 0023 written, ADR 0011 marked amended.

## Blocked by

- 08 — Hugo reads each client folder's sharing from Drive
- (release) 09 — The office shares the accountants' group folders with their Hugo accounts
