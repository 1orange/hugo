# 18 — Omega export takes partner details from the directory

Type: AFK
Status: done
User stories: 54

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The Omega export's partner enrichment (ADR 0019, ADR 0022) reads a counterparty's legal name, address
and DIČ from the subject directory first and calls the registers only for unknown or stale subjects,
recording the result in the directory. Manual corrections from the directory are exported. The
per-company partner list remains the record of what was exported for each client. A register outage no
longer costs a known partner's address.

## Acceptance criteria

- [ ] Exporting a month whose partners are all in the directory makes no register calls.
- [ ] An unknown partner is looked up once, stored in the directory and exported.
- [ ] A manually corrected subject is exported with the corrected values.
- [ ] With the registers down, known partners still export with full details.
- [ ] The per-company partner list is still written.
- [ ] Omega-export integration tests with fake registers cover all of the above.

## Blocked by

- 13 — Subject directory, with name and DIČ verified against the registers
