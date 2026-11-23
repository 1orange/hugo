# 06 — *Chýba mesačná štruktúra*: a company-level structure issue

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

On the live drive, 14 clients with documents keep them in layouts Hugo does not read, and 8 client
folders are empty. Today they look like clients that uploaded nothing. The office fixes structure in
Drive, so Hugo must **say so**. It does not read these layouts.

- **Company layout (pure, deep).** From a client folder's child and grandchild folder names, return:
  - `months`: `YYYY_MM` folders for the current year exist directly in the client folder;
  - otherwise the layout found: `year-months` (`2026 / 2026_10 / …`), `year-types`
    (`2026 / 02 Prijaté faktúry`), `types` (type folders directly in the client folder), `empty`, or
    `other`;
  - plus example folder names that show it.
  "Current year" is the booking month's year. Year folders for earlier years beside current `YYYY_MM`
  folders (`2023`, `2024`, `2025`) count as `months`, not as an issue.
- **New deviation kind `month-structure-missing`**: company-level and *blocking*. The sweep's
  structure check writes it like the existing kinds. Its detail holds the layout and the example
  names. When present, it suppresses that company's per-month findings. It clears on the first sweep
  where the layout is `months`. Archived clients are not checked.
- **Display.** *Firmy* shows it through the existing structure mark and count. The company's structure
  screen shows *Chýba mesačná štruktúra*, what was found (in Slovak, per layout), what is expected
  (`2026_01 … 2026_12` directly in the client folder, type folders inside each month), and a link to
  the client folder in Drive. No one-click fix: Hugo does not create or move folders (ADR 0006).
- Nothing is read from these layouts and no moves or renames are proposed there (as today; keep it
  so).

## Acceptance criteria

- [x] Company layout unit tests, one anonymised fixture per live shape: `months`; `months` with older year folders beside it; `year-months`; `year-types`; `types`; `empty`. (`tests/unit/modules/company-layout.test.ts`; `other` is covered too.)
- [x] The sweep writes one `month-structure-missing` deviation for such a company and no per-month findings for it; archived companies get none (integration test). Note: the per-month suppression is structural (a non-`months` layout has no current-year month folders, so the per-month check has nothing to report); the test asserts the single row.
- [x] After month folders are added in the fake Drive, the next sweep clears the deviation and discovers and queues the files in them.
- [ ] *Firmy* marks the company and counts it among structure problems. The structure screen shows found, expected and the Drive link (UI test). Unmet in part: the count is asserted in the integration test (`countStructureDeviationsByCompany`), but no UI spec was written (not asked; Playwright not run), so the screen rendering is not covered by a test.
- [x] The deviation is idempotent: a repeated sweep over unchanged input writes nothing new. (Stored rows are kept as they were, with their ids and detection time.)

## Blocked by

None - can start immediately
