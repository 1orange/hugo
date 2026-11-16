# 05 — Confirm the live Drive layout before checking it

Type: HITL
Status: done
User stories: — (PRD Further Notes)

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The structure check is specified from the snapshot in `.agents/ctx/gdrive/structure`, where the
past-year folders `2024` and `2025` are empty. Before slice 07 ships, someone with access to the live
shared drive confirms:

- what archive-year folders contain (month folders, flat files, or both), and whether they should be
  checked or left opaque as the PRD assumes;
- whether any company folders still use the old subfolder names (`04 Bločky_hotovosť`,
  `05 Bločky_firemná karta`) and how many — if many, decide whether a one-time confirmed bulk rename
  is worth a follow-up slice;
- whether any company folder legitimately lacks the `Konto ` prefix (e.g. an internal folder at the
  root) and should be excluded rather than reported.

A read-only script or a sweep in a dry-run mode against the service account may be used to gather the
counts; no Drive changes are made. Record the answers in the PRD's Further Notes and, if a decision
changes, in the ADR 0007 amendment.

## Acceptance criteria

- [ ] Archive-year contents are described and the "opaque archive" decision is confirmed or changed.
- [ ] The number of folders still on old names is known, with a decision on a bulk rename.
- [ ] Root-level folders that are not client companies are listed, with a decision on how to treat them.
- [ ] The PRD (and ADR 0007 if needed) records the outcome.

## Blocked by

None - can start immediately

## Findings, 2026-11-12

Gathered read-only with the service account (aggregates only; nothing in Drive was changed).

- **Archive years: decided — ignored for now.** The archive-year folders (`2024`, `2025`, …) are
  left opaque, as the PRD assumed: not descended into, no deviations from their contents. (Live, they
  hold month folders, loose files and other folders: 48 year folders with 300 month folders, 61 files
  and 152 other folders inside.)
- **The service account could not see the shared drive's files.** `files.list` used the default
  `user` corpus, which leaves out shared-drive items. It now asks `corpora=allDrives`; with that the
  shared drive is visible.
- **The live layout has a level the snapshot does not.** The shared drive's root holds one folder per
  accountant — `Eva – doklady klientov` (8 company folders), `Katarína – doklady klientov` (31) — and
  `Archív – doklady klientov` (1). Company folders sit inside those, not at the root, so a single
  `DRIVE_PARENT_FOLDER_ID` cannot cover them. **Open:** sweep several parents (one per accountant
  folder, which could also seed *Moje firmy*), or one parent with the accountant level recognised.
- **No company folder carries the `Konto ` prefix yet** (0 of 40). Until the office renames them,
  `company-prefix-missing` would flag every company. **Open:** confirm the rename is planned, or keep
  the prefix check off until it is.
- **Old subfolder names are still in use:** 48 month subfolders named `04 Bločky…` / `05 Bločky…`
  across the 138 month folders (all in one accountant's companies). They are repair candidates
  already (ADR 0007). **Open:** whether a confirmed bulk rename is worth a slice.
- 5 files sit directly in company folders (`file-misplaced` in slice 07).

**Decided the same day:** the live drive is the source of truth. `DRIVE_PARENT_FOLDER_ID` is the
shared drive's root; a root folder named `<Name> – doklady klientov` is an accountant group, and the
company folders inside it are swept with that group (`companies.group_name`). *Firmy* shows every
group's companies with a filter per group (kept per user in browser storage). A dry run over the live
listing finds all 40 companies: Eva 8, Katarína 31, Archív 1.

**Prefix, decided:** the office renamed every company folder to `Doklady <company>` (40 of 40). The
display name strips `Doklady ` (and the older `Konto `); slice 07's `company-prefix-missing` should
expect `Doklady `, and treat group folders at the root as expected.

**Older subfolder names, decided:** accepted as their slots, not renamed (ADR 0007 amendment of
2026-11-12). Live, only `06 Cestovné príkazy` (10 months), one bare `Bločky`, and the typo
`05 Bločky firmná karta` (a repair candidate) remain flagged.

Status of this issue: the questions are answered; slice 07 is unblocked.

## Update, 2026-11-12 — the office's structure document

The office's own description (`.agents/ctx/Štruktúra disku Doklady klientov – podklad pre
dashboard.md`) supersedes the guesses above: levels are read by depth (every root folder an
accountant or the archive, every folder in it a client), months by a `YYYY_MM` prefix, and types by
code from 2027_01, by name before (ADR 0007 amendment of 2026-11-12, rewritten).
