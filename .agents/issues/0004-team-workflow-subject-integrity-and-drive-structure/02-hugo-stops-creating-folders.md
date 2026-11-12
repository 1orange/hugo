# 02 — Hugo stops creating folders

Type: AFK
Status: done
User stories: 57, 58, 62

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The office owns the Drive structure (ADR 0005 and ADR 0006 amendments, 2026-11-11). Remove every path
by which Hugo creates folders: month-subfolder scaffolding on each sweep, creating month N+1 and its
subfolders when month N is closed, and creating a missing destination slot for a late-arrival move.

Closing a month now only writes `closedAt` and records `MonthClosed`. A late arrival whose destination
slot is missing in the open month stays `pending` with a warning naming the missing folder (*V mesiaci
2026_11 chýba priečinok 02 Prijaté faktúry*); once someone creates the folder in Drive, the next sweep
offers the move again. Folder renames for near-miss repairs (ADR 0007) are unchanged. Retire the
folder-create mutation if nothing else uses it.

## Acceptance criteria

- [ ] No sweep, dashboard load, close or late-arrival action issues a folder-create call to Drive (asserted with the fake Drive client).
- [ ] Closing a month records the close and the event and changes nothing in Drive; reopening still works.
- [ ] A late arrival with a missing destination slot shows the warning instead of a move proposal and keeps its `pending` status.
- [ ] After the slot appears in Drive, the next sweep turns the warning into a normal move proposal.
- [ ] Near-miss folder rename repairs and their undo still work.
- [ ] Existing tests that expected scaffolding are rewritten to expect no creation; sweep, month-lifecycle and drive-mutation integration tests pass.

## Blocked by

None - can start immediately
