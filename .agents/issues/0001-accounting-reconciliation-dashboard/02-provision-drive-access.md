# 02 — Provision Drive access

Type: HITL
Resolves: PRD open questions 4 and 5

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Human groundwork that unblocks every slice touching real client data. No application code.

Create a Google Cloud project and a service account with the Drive API enabled. Reorganise Drive
so that every company folder sits under a single parent folder, and share that one parent with the
service-account address as Editor. This is the entire access model per ADR 0001 — there is no
OAuth flow for Drive.

Then verify the assumption the late-arrival feature rests on. Clients upload into folders she owns,
so **clients own those files**. Write access through folder permission inheritance is expected to
permit moving them, but this has not been confirmed against reality. Take one real
client-uploaded file, read its `capabilities`, and confirm `canMoveItemWithinDrive` is true. If it
is false, slice 13 needs redesigning and that must be known before it is built, not during.

## Acceptance criteria

- [ ] Google Cloud project created with the Drive API enabled
- [ ] Service account created and its key stored as a secret on the VPS, readable only by the service user
- [ ] All company folders relocated under one parent folder
- [ ] The parent folder shared with the service-account address as Editor
- [ ] A single `files.list` call from the service account returns files from at least two different companies, confirming inheritance works
- [ ] `capabilities.canMoveItemWithinDrive` checked and recorded for at least one real client-uploaded file in `02 Prijaté faktúry`
- [ ] `capabilities.canRename` checked and recorded for one month subfolder
- [ ] Findings written back into the PRD open questions section, marking 4 and 5 resolved or reopened with detail

## Blocked by

None - can start immediately
