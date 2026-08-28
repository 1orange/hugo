# ADR 0012 — Append-only domain event log

Date: 2026-08-28
Status: Accepted

## Context

"Event-driven" came up as a design preference, and it had two possible readings: Drive push
notifications as the ingestion mechanism, or internal domain events as the way state changes
propagate. The ingestion question is settled separately in ADR 0003 — push is a trigger, not a
parallel path.

The internal reading has independent justification. The app mutates folders belonging to her
clients (ADR 0006), exports data into her books (ADR 0010), and operates in a context with a
10-year retention obligation. It needs to be able to answer "what happened to this document, and
when" — both for her own confidence and for a client who asks.

She also asked specifically for a per-company view of everything the app and she did.

## Decision

An **append-only `events` table**: timestamp, company, actor (`system` | `user`), type, payload
JSON. Never updated, never deleted.

Events are emitted by the sweep diff and by user actions: `FileDiscovered`,
`FileRenamedInDrive`, `FileMovedByClient`, `FileDeleted`, `Extracted`, `Paired`, `Unpaired`,
`Confirmed`, `MonthClosed`, `MonthReopened`, `Moved`, `Renamed`, `FolderCreated`, `Exported`.

The **per-company activity log is a query over this table**, not a separate structure.

The event log is the audit trail. It is *not* the undo mechanism: undo reads the previous parent
and previous name from `drive_mutations` (ADR 0006), which is purpose-built for reversal. The
events explain what happened; `drive_mutations` is what makes it reversible.

### Amendment, 2026-08-28: the vocabulary lives in code, and the compiler enforces it

The list above is incomplete — slice 14a added `CanonicalFolderNamesChanged`,
`MovableFolderNamesChanged` and `DriveParentFolderIdChanged`, which are global rather than
per-company and so carry a null company. That it went stale within a day of being written is the
point: a type list in prose cannot be the source of truth for something this ADR itself calls a de
facto interface.

The vocabulary is therefore `src/modules/activity-log.ts`, which holds the types alongside their
human-readable labels and payload summaries. This document describes the decision; that module is
the list.

Two checks keep the two halves honest. A test fails if a type has no label, so history cannot
render a bare identifier. More usefully, the emit functions accept the vocabulary type rather than
`string`, so a slice that invents a type outside the list fails the build at the emit site — the
label test alone could not catch that direction, and it is the direction a future slice will
actually take.

Global events surface in an "All activity" view. Scoping the log per company, as originally
specified, would have silently hidden every settings change she makes.

## Consequences

- The per-company activity log costs a query rather than new machinery.
- Undo becomes trustworthy, because there is a visible record of what it will reverse.
- "When did this document first appear" is answerable, which matters when a client claims they
  uploaded something on time.
- The sweep must be idempotent or the log fills with noise. A repeated sweep over unchanged input
  emits nothing. This is a tested property (ADR 0003).
- The table grows without bound. At low hundreds of documents a month this is irrelevant for
  years, and it is append-only by intent — pruning would defeat the purpose.
- Event payloads are a de facto interface. Renaming a type or changing a payload shape breaks the
  readability of history, so they should be treated as more stable than internal code.

## Alternatives considered

- **Event sourcing as the primary persistence model**, with current state as a projection.
  Rejected as heavy for a single-user app: the tables here are small and directly queryable, and
  rebuilding state from events would add machinery without a use case.
- **Mutable audit rows updated in place.** Cheaper to query for "current status", but destroys the
  history that justifies the log.
- **No event log; rely on `updatedAt` columns.** Sufficient for the UI, useless for explaining a
  change to a client or for grounding an undo button.
