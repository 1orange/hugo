# 03 — Drive sweep to company and month tree, read-only

Type: AFK
User stories: 2, 3, 11, 12, 13, 14, 15

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The ingestion path and the first genuinely useful screen: she opens the app and sees her clients,
their months, and the documents in each folder slot.

A single paginated `files.list` over everything the service account can see returns a flat list;
the tree is reconstructed in memory from `parents`. This is the only ingestion path in the system
per ADR 0003. It is invoked by a manual Refresh button and by dashboard load when the last sweep is
stale. No scheduler.

`FolderTaxonomy` owns month folder naming (`YYYY_MM`), the canonical subfolder list, and
classification of an observed folder name as canonical, repair-candidate or unknown. For this
slice the canonical list is a seeded constant; slice 14 makes it editable. Matching is on the
exact canonical name — no prefix or fuzzy fallback, per ADR 0007.

`DriveTree` takes the flat file list plus stored state and returns the reconstructed tree and a
diff. The diff is the sole producer of `FileDiscovered`, `FileRenamedInDrive`, `FileMovedByClient`
and `FileDeleted` events. Both modules are pure — no network, no database — so they are testable
from fixtures.

Files are keyed by **Drive file ID**, never by path, so that a later rename or move does not lose
work already recorded against a document.

The real `DriveClient` sits behind a port; tests use a hand-written fake, so this slice does not
wait on slice 02 to be completed and verified.

Screens: company list showing each company and its open month; month view listing documents grouped
by folder slot; the four VAT output PDFs at the month root shown but explicitly marked as
untouchable outputs. Last successful sweep time is visible.

## Acceptance criteria

- [ ] `FolderTaxonomy` parses `YYYY_MM` and rejects malformed month names
- [ ] `FolderTaxonomy` classifies `04 Bločky_hotovosť` as canonical and `04 Bločky_hotorvosť` as a repair-candidate naming the correct target
- [ ] `FolderTaxonomy` never silently maps an unknown folder name to a canonical slot
- [ ] `DriveTree` reconstructs the correct tree from an unordered flat list
- [ ] A newly appearing file produces exactly one `FileDiscovered` event
- [ ] A file whose parent changed produces `FileMovedByClient`, not a second discovery
- [ ] A file absent from a later sweep produces `FileDeleted` and its row is retained, not removed
- [ ] A repeated sweep over unchanged input produces zero events (idempotence)
- [ ] `firstSeenAt` is recorded on discovery and never overwritten
- [ ] Company list shows every company under the parent folder with its open month
- [ ] Month view groups documents by folder slot and shows month-root VAT PDFs as outputs
- [ ] Last successful sweep timestamp is visible to the user
- [ ] Refresh triggers a sweep; loading the dashboard with a stale sweep triggers one automatically
- [ ] Integration test: sweep against a recorded `files.list` response yields the expected tree, events and file rows; running it twice changes nothing

## Blocked by

- 01 — Walking skeleton, deployed
