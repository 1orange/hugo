# 06 — Replace document fields atomically on manual re-extraction

Type: AFK
Status: ready-for-agent
User stories: 55–62

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

Change explicit *Načítať znova* into a non-destructive replacement attempt. Requesting a manual
re-extraction must leave the active extracted, confirmed, and derived accounting data visible while
the fresh pipeline runs. Stage the fresh result separately. A successful extraction atomically
promotes it for every document belonging to the source file and clears all previous manually saved
accounting fields, calculated values, derived provenance, and stale typed eKasa input so nothing can
shadow the new result. Even a sparse but structurally valid success is authoritative.

If extraction fails or is interrupted, discard the staged result, preserve every active accounting
field, and show the failure reason. Preserve notes, file/document identity, and append-only audit
history on either outcome. Record the request and its success or failure. Retain the existing rule
that a closed month or any decided/exported document from the source file prevents re-extraction.
This replacement permission applies only to an explicit user request; background extraction and
pipeline upgrades must not gain permission to clear confirmed values.

## Acceptance criteria

- [ ] Requesting manual re-extraction marks a replacement attempt pending without clearing or hiding active extracted, confirmed, or derived values.
- [ ] A fresh result is staged separately and cannot leak into the active view before successful promotion.
- [ ] Success atomically replaces extraction data and clears all prior manual accounting fields, calculated values, derived provenance, and stale typed UID across every document from the source file.
- [ ] A sparse but structurally valid successful result replaces old values rather than merging with them.
- [ ] Failure or interruption preserves the full prior active state and exposes the fresh failure reason; retry remains possible.
- [ ] Notes, file/document identity, and append-only event history survive both success and failure.
- [ ] Request, completion, and failure events identify company, month, file, document, source, and outcome sufficiently for audit.
- [ ] Re-extraction remains unavailable when the month is closed or any document from the file is decided or exported.
- [ ] Background refresh and pipeline-version changes still cannot clear confirmed values.
- [ ] Integration tests cover pending visibility, success replacement, failure rollback/preservation, sparse success, notes, typed UID, audit events, protection rules, and multi-document file atomicity.
- [ ] An end-to-end test saves a manual field and note, requests re-extraction, verifies the field is replaced only after success, and verifies the note remains.

## Blocked by

None - can start immediately
