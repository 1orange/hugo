# 12 — Read the client sheet straight from Drive

Type: AFK
Status: open

## What to build

The sheet is a Google Sheet the office keeps current (its *Aktualizované* column), so a one-off upload
goes stale. In *Nastavenia*, she can give the sheet's link instead. Once the sheet is shared with
Hugo's service account, Hugo exports it as CSV through the Drive API. It reads the sheet only when the
sheet has changed, which the Changes feed or `modifiedTime` shows, at most once per sweep. Each time it
prepares the same preview as the upload.

Changes to fields she never edited by hand are applied by themselves and logged. The rest, and every
disagreement, wait in the preview for her confirmation. Nastavenia shows when the sheet was last read.
It says plainly when the sheet is not shared with the service account, naming the account's email.

## Acceptance criteria

- [ ] A sheet link (or id) in settings, validated, with "last read" and a sharing hint on failure.
- [ ] The sweep reads it only when modified, through a fake Drive client in tests.
- [ ] Changes only to fields never hand-edited are applied by themselves and logged. Others wait for confirmation.
- [ ] An integration test on PGlite with the fake Drive covers changed, unchanged and refused (not shared) sheets.

## Blocked by

- 09 — Fill company profiles from the office's client sheet

## Note, 2026-11-16

The import writes to the Adresár (0006/02 and 0006/04), not to company profiles. Blocked by 0006/04 as well.
