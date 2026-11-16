# 15 — *Prevziať z registra* and filling missing fields from the directory

Type: AFK
Status: done
User stories: 34–36, 46, 47

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Let the accountant act on a finding and let the directory save typing, without overwriting anything on
its own. A flagged party gets *Prevziať z registra*, which writes the subject's legal name, DIČ and IČ DPH
as the accountant's confirmed values with a new provenance `register` (badge *z registra*). For a party
whose IČO or VAT ID matched a directory subject, **missing** DIČ or IČ DPH are filled with provenance
`directory` (badge *z adresára*); a conflicting printed value is never replaced and stays a finding.
Values typed by the accountant always win (ADR 0010). Each sighting records the printed name as an alias
of the subject, so trade names (*CENTRAL Bratislava*) are recognised later. The Omega export and the
fields panel consume the same effective values.

## Acceptance criteria

- [ ] *Prevziať z registra* fills the three fields, clears the mismatch and shows *z registra*.
- [ ] Missing fields of a known subject are filled with *z adresára*; printed values are never replaced.
- [ ] A typed value is never overwritten by either provenance, including after re-extraction or refresh.
- [ ] A printed alias is recorded and later resolves to the same subject.
- [ ] Unit tests cover provenance precedence; integration tests cover alias recording; a fields-panel UI test covers the button and badges.

## Blocked by

- 13 — Subject directory, with name and DIČ verified against the registers
