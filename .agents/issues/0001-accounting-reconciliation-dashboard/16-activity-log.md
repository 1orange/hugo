# 16 — Per-company activity log

Type: AFK
User stories: 64, 65, 66

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Thin, but it is what makes the undo buttons elsewhere trustworthy: a visible record of what
happened.

Per ADR 0012 the `events` table is append-only and already populated by earlier slices. This slice
is the read surface: a per-company view rendering that history in reverse chronological order, with
filtering by event type and by month.

It must answer three questions she will actually be asked. What happened to this document and when.
When did this document first appear — which matters when a client claims they uploaded something on
time. And what exactly did the app change in Drive, so that a client asking "who renamed my folder"
gets an answer rather than a shrug.

The log is presentation only. It must not become a second source of truth: undo continues to read
the previous parent and previous name from `drive_mutations`, which is purpose-built for reversal,
while events explain what happened.

Event payloads are effectively an interface — renaming a type breaks the readability of history — so
this slice is also the point at which the vocabulary gets fixed and documented.

## Status

Done. Per-company log at `/companies/[companyId]/activity`, global settings events at `/activity`,
vocabulary in `src/modules/activity-log.ts`. See the amendment in ADR 0012.

The `Paired` and `Unpaired` entries in that vocabulary have nothing left to emit them under
ADR 0013. Slice 22 removes them, which is only safe because nothing is deployed and no event
history exists; with real history they would have to stay as read-only vocabulary, since a renamed
or missing type breaks the readability of the past.

## Acceptance criteria

- [x] Per-company activity view lists events in reverse chronological order
- [x] Filterable by event type and by month
- [x] Each entry states the actor as system or user
- [x] Drive mutations show what changed, including the previous name or parent
- [x] A document's first-seen time is directly answerable from the log
- [x] The view is a query over `events` with no additional persistence
- [x] Undo continues to read from `drive_mutations`, not from the event log
- [x] The event type vocabulary is documented in one place, and emit sites are type-narrowed to it
- [x] A repeated sweep over unchanged input adds no entries, keeping the log readable
- [x] Integration test: a sequence of actions produces the expected ordered event stream

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
