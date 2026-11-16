# 08 — *Moje firmy*

Type: AFK
Status: done
User stories: 1–13

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Each accountant marks the companies assigned to them directly in the *Firmy* table and switches between
*Moje firmy* and *Všetky firmy* (ADR 0011 amendment: a personal filter, not a permission). Assignment
and the toggle position live in `localStorage` under a key namespaced by the signed-in email, as a
versioned JSON value; companies are identified by Drive folder id.

A pure assigned-companies module owns parsing (corrupt or foreign values become empty, never throw),
add/remove and filtering; unknown ids are ignored, not pruned. A thin client wrapper filters the
server-rendered rows and recomputes the summary strip with the existing chase-list summariser over the
visible rows, so every figure counts only what is shown. The page shows how many companies are hidden,
a hint when *Moje firmy* is empty, and works with the month picker. Before hydration and when storage
is blocked the page shows *Všetky firmy*, with assignment controls disabled and a short explanation.
Server work (sweep, warming extraction) ignores the filter.

## Acceptance criteria

- [ ] Marking and unmarking a company persists across reloads; two emails in the same browser keep separate lists.
- [ ] *Moje firmy* shows only assigned companies; summary figures match the visible rows; a hidden-count line is shown.
- [ ] An empty *Moje firmy* shows a hint, not an empty table.
- [ ] The filter combines with the selected month.
- [ ] A company missing from Drive drops out without error and reappears with its assignment if it returns.
- [ ] Blocked or throwing `localStorage` degrades to *Všetky firmy* without errors.
- [ ] Unit tests cover the module (parse, corrupt values, per-user keys, add/remove, filter, summary); a UI test covers blocked storage; a Playwright test covers assigning two companies and the summary changing.

## Blocked by

None - can start immediately
