# 08 — Hugo reads each client folder's sharing from Drive

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

The office wants Drive sharing to decide who sees which company. This issue only **reads and shows**
the sharing. Nothing is restricted until issue 10, so the office can check who would see what first.

- **Drive adapter.** "List a folder's permissions": `permissions.list` with `supportsAllDrives`;
  fields type, role, emailAddress, domain, permissionDetails (inherited). Verified on the live drive:
  a client folder's list includes shared-drive members and parent-folder grants (inherited) as well as
  direct grants. The fake Drive client gains permissions, settable in tests and the e2e fixture.
- **Access snapshot.** A new table of each company's principals: type (`user | group | domain |
  anyone`), email or domain (lower-cased), role, inherited, refreshed time. Replaced wholesale per
  company on refresh. A failed refresh keeps the previous snapshot and records the error.
- **Refresh.** On every poll, on *Obnoviť*, and when a sweep's change log reports a change to a
  company folder or a group folder. One Drive call per company.
- **Visibility rule (pure, deep).** `canSee(email, principals)`: true for a `user` principal with that
  email (case-insensitive), a `domain` principal matching its domain, or an `anyone` principal. `group`
  principals are not expanded and are reported as unsupported. No snapshot means not visible.
- **Settings: *Prístup z Drive*.** Per company, which allowlisted users can see it under the rule, and
  any group grants (flagged as unsupported: share with people directly). Also when the snapshot was
  last refreshed, and any error.

## Acceptance criteria

- [x] Visibility rule unit tests: direct user, inherited user, domain, anyone, group (not visible and reported), letter case, no snapshot. (`tests/unit/modules/company-access.test.ts`)
- [x] A poll refreshes every company's snapshot. A failed Drive call keeps the previous one (integration test with the fake Drive). Note: the test calls `runSweep(client, { allAccess: true })`, which is what the poll job passes; the worker's job-name choice is not separately tested.
- [x] A change-log entry for a company or group folder triggers a refresh of the affected companies. (`tests/unit/access/company-access-integration.test.ts`)
- [x] Settings lists, per company, the allowlisted users who can see it and any group grants. Note: a rendered-markup unit test (`tests/unit/access/drive-access-section.test.ts`), not a Playwright spec, since UI specs were not requested and Playwright was not run.
- [x] Nothing that users see in the company list or on company screens changes yet. (No list or company-screen query was changed; the only user-visible addition is the settings section.)

## Blocked by

None - can start immediately
