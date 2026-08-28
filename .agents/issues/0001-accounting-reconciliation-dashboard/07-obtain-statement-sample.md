# 07 — Obtain a decrypted statement sample

Type: HITL
Resolves: PRD open questions 2 and 3

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Human groundwork. No application code, but slice 08 — and therefore the entire reconciliation
surface — cannot start without it.

The bank statements in `03 Bankové výpisy` are password-protected. `qpdf --check` on a real sample
returns "invalid password" with an empty password, meaning a user password is required: the files
cannot be read, rendered or OCR'd without it. Metadata is encrypted too (`R: 4`, AES-128), so even
the producer string is opaque and the issuing bank cannot be identified from the file itself.

Collect, from her:

- the statement password for at least the first client,
- which bank issues that client's statements,
- a rough inventory of which banks appear across all her clients, and
- one statement per bank, opened successfully, so the layout can be read.

Then decide which bank goes first. Build one end-to-end before adding others, per ADR 0009.

Statement content is real client financial data. Samples used as test fixtures must be redacted:
counterparty names, IBANs and account numbers replaced with synthetic values, while preserving the
layout and internal arithmetic so that `reconcile()` remains a meaningful assertion.

## Acceptance criteria

- [ ] Statement password obtained for at least one company
- [ ] The issuing bank identified for that company
- [ ] An inventory of banks across all clients recorded, with rough frequency
- [ ] At least one statement per bank opened successfully and its layout documented
- [ ] First bank chosen and recorded
- [ ] A redacted fixture produced for the first bank, with synthetic counterparties and IBANs and arithmetic preserved
- [ ] Confirmed whether any client's statement lacks a text layer entirely, since that would need a different approach
- [ ] PRD open questions 2 and 3 updated

## Blocked by

None - can start immediately
