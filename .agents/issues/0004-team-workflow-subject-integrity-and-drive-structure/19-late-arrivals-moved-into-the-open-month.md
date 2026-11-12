# 19 — Late arrivals moved into the open month

Type: AFK
Status: done
User stories: PRD 0001 stories 45–51; PRD 0004 story 62. Supersedes PRD 0001 issue 13, never built.

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Feedback, 2026-11-12: *late arrivals should be moved to the current month that is open; the open
month is the current month by default.*

A file that arrives in a closed month after its close is logged as a late arrival. On the open month
(the current calendar month, ADR 0005 as amended 2026-11-11) she sees the late arrivals of every
closed month: those in a movable folder (`02`, `04`, `05`, `06` by default, ADR 0006) are proposed
for the open month's folder of the same name and moved in one click; the others are warnings. A
closed month that received one points to the open month.

- **Lateness** is judged on Hugo's own clock: the time the file arrived in its month (first seen
  there, or moved there from another month by anyone), after the month's `closedAt`. Drive's
  `createdTime` is not used: a client's copy carries any creation time, and a file uploaded just
  before the close but swept just after it was not in the month she closed either. A move between
  folders of one month is not an arrival.
- **The log** (`late_arrivals`) is persistent, one row per file, with status
  `pending | moved | ignored | resolved`. Each sweep logs new late files and resolves pending ones
  that are late no more (deleted, moved out, month reopened); an ignored one stays ignored unless the
  file arrives again.
- **Warnings instead of a move:** a folder that is not movable (`01`, `03`, `07`); no open month; the
  open month lacks the folder (Hugo does not create it, ADR 0006 amended 2026-11-11); Drive reports
  `canMoveItemWithinDrive: false` (now stored per file by the sweep).
- **The move** is recorded in `drive_mutations` (kind `move`) before Drive is touched, marked applied
  once Drive confirms, failed otherwise; one refusal does not stop the batch. The documents follow
  their file into the open month with extraction kept (a document used to keep its old month when its
  file moved to another month, and vanished from both — fixed for every move, a client's included).
- **Undo** puts the file back where it arrived and the late arrival back to pending; refused when the
  file was moved again since, when its document was decided or exported in the new month, or when the
  month it was moved to is closed.
- `Moved` events for the move and the undo, `LateArrivalIgnored` for ignoring.

## Acceptance criteria

- [x] A file arriving after `closedAt` in a movable folder yields a proposal for the open month, same folder
- [x] The same file in `03` (or `01`, `07`) yields a warning and no proposal
- [x] A file there before the close yields nothing; month-root files never appear
- [x] A file a client moves into a closed month from another month is a late arrival
- [x] Every late arrival is logged with a status and survives a reload; ignored ones leave the list
- [x] One action moves every proposal for a company; each move writes a `drive_mutations` row with the source parent
- [x] A missing destination folder is a warning naming it, never created
- [x] A file Drive will not move is a warning; a refusal during the batch is recorded as failed
- [x] A moved file keeps its extraction, and its document is listed in the open month
- [x] Undo returns the file to its original folder and marks the mutation undone; refused when moved again since
- [x] Reopening the month resolves its pending late arrivals
- [x] `Moved` events for both the move and the undo
- [x] E2E: confirm a batch, then undo one move; ignore one (`tests/e2e/late-arrivals.spec.ts`)
- [x] A folder under an older name (`04 Bločky`) is a destination for its slots

## Blocked by

None.
