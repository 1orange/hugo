# 12 — Bank statements appear in the document list

Type: AFK
Status: ready-for-agent

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

Statements are presence-only (ADR 0013): Hugo records that one arrived but never lists it. The office
wants to see them next to the other documents, and plans to import them into Omega later. (Their
message said "(05)". On the drive, statements are `03 Bankové výpisy` in every layout.)

- Files in the `03 Bankové výpisy` slot get document rows and appear in the month's document list in
  their own group, *Bankové výpisy*, after the other types.
- The workbench previews them with the existing preview: PDF and images rendered, XML shown as text.
  No field form, only the preview, the file name and the decision bar.
- A new terminal extraction state, *nečíta sa* (not read). Statements are never queued for either
  reading lane, never OCR'd and never sent to the model. Issue 01's backlog query excludes them.
- Decisions *confirmed* and *not relevant* apply. An undecided statement counts in the month's to-do
  and in *Firmy*'s waiting count.
- Excluded from the Omega export.
- The chase list's statement presence (*bez bankového výpisu*) is unchanged.
- Amend ADR 0013 (2026-11-23): statements are listed and decided, still not read.

## Acceptance criteria

- [ ] A sweep discovering a statement creates its document row in the *nečíta sa* state. It is never queued (integration test).
- [ ] The month's document list shows statements in their own group. Selecting one shows its preview and the decision bar, with no fields (UI test with a PDF and an XML statement).
- [ ] Confirming or marking a statement not relevant updates the month's to-do count.
- [ ] The Omega export ignores statements (export test).
- [ ] Chase list presence tests pass unchanged.
- [ ] ADR 0013 amended.

## Blocked by

None - can start immediately
