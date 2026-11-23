# 09 — The office shares the accountants' group folders with their Hugo accounts

Type: HITL
Status: ready-for-human

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

On the live drive today, only two shared-drive members and the service account have office-side
access to the client folders. Most direct grants are the clients' own addresses. Once issue 10 ships,
an accountant whose Google account has no access to a client folder sees no companies at all. Before
issue 10 is released:

1. The office confirms the Google account each accountant signs in to Hugo with, and that it is on the
   allowlist.
2. The office shares each accountant's group folder (e.g. "Eva – doklady klientov") with that account,
   or individual client folders where portfolios are mixed. Shared-drive members already see
   everything. Google Groups are not supported: share with people directly.
3. In Settings → *Prístup z Drive* (issue 08), the office checks that every accountant sees exactly
   their companies, and that every active company is visible to at least one accountant.

## Acceptance criteria

- [ ] Each accountant's sign-in account is confirmed and on the allowlist.
- [ ] Group folders, or client folders, are shared accordingly.
- [ ] *Prístup z Drive* shows the intended visibility for every accountant, and no active company is visible to no one.
- [ ] The office approves releasing issue 10.

## Blocked by

- 08 — Hugo reads each client folder's sharing from Drive
