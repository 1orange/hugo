# 15 — The first real Omega import

Type: HITL
Status: deferred
User stories: —

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

Deferred by her choice on 2026-09-27; kept here so the unknowns are not lost. The writer from
slices 07 and 08 is built to the vendored spec and her `T01` sample. This slice settles what only
Omega can answer.

Generate a real month's file, import it into a copy of a company or a test firm in her Omega — never
her live books — and read the `.LOG` written beside it, which is the only honest confirmation (ADR
0014). Settle the unknowns listed in ADR 0019:

1. a `T01` received invoice (type 14) with no accounts and no series codes — does it import, and
   where does it land;
2. a prefixed export number that does not follow the series counter;
3. a `T00` receipt with MD and DAL empty;
4. a `T00` receipt naming a new partner, once a `T04` section precedes it;
5. the same file imported twice — is everything skipped the second time;
6. dot decimals — are the amounts right in every field written;
7. a foreign-currency document with the rate fields empty — does Omega fill them from its own list.

Plus whether Omega 29.20 accepts the 28.00 spec for `T00`, and how a foreign partner with no IČO is
matched.

## Acceptance criteria

- [ ] A generated file is imported into a test firm or company copy, not live books
- [ ] Each of the seven unknowns is answered from the `.LOG` and the imported documents
- [ ] The answers are recorded as an amendment to ADR 0019, and PRD 0002's open questions 1, 2 and 7 are updated
- [ ] If empty MD and DAL are rejected, the fallback — a constant account pair she nominates, or receipts left out — is decided with her and recorded
- [ ] Any writer change the import reveals is made, with a test reproducing it

## Blocked by

- 08 — The Omega file: receipts
