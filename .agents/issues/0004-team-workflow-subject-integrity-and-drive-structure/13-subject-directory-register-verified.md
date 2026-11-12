# 13 — Subject directory, with name and DIČ verified against the registers

Type: AFK
Status: done
User stories: 28–31, 38, 39, 43–45, 52, 55, 56

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

Introduce the shared subject directory of ADR 0022 and use it to verify each counterparty against the
registers. Schema: a global subjects table keyed by `(country, IČO)` (foreign subjects by normalised VAT
ID) with legal name, former names, aliases with counts, DIČ, IČ DPH, address, register status, per-value
source, `verifiedAt`, `lastSeenAt` and per-field manual markers; settings gain the refresh age
(default 30 days). Client companies link to their subject through their profile's IČO; where profile
and directory disagree, the profile wins and the entry is flagged.

A subject-directory service resolves a party by IČO, then VAT ID, then exact alias. Unknown or stale
subjects are fetched through the `CompanyRegister` port (RÚZ/RPO for SK, ARES for CZ) **on the worker**,
one lookup in flight per key across replicas, rate-limited. After extraction and after any identity
edit, the worker resolves each counterparty, runs subject-integrity with the register answer and stores
the verdict on the payload; pages read only stored verdicts. Integrity adds: name compared with current
and former legal names using the core-company-name normalisation (former name → notice; another
company's name → mismatch showing the register's name), and DIČ compared exactly. A register failure
gives `unavailable` with offline checks still applied and leaves the directory unchanged. Existing
documents are verified lazily on next open or extraction.

## Acceptance criteria

- [ ] First resolution of a subject calls the fake register once and stores it; later resolutions make no call.
- [ ] Data older than the refresh age is refreshed in the background on the next sighting.
- [ ] A Slovak and a Czech subject with the same IČO stay separate.
- [ ] `SLOVNAFT a.s.` and `Slovnaft, a. s.` match; a former name is a notice; another company's name is a mismatch naming the register's legal name; a wrong DIČ is a mismatch.
- [ ] A register outage yields `unavailable` without blocking the document.
- [ ] Rendering a document never calls a register.
- [ ] A client company appearing as a counterparty resolves to its linked subject.
- [ ] Integration tests against the store test database with fake registers cover resolution, caching, staleness, collisions, aliases and failures; unit tests cover the new integrity rules.

## Blocked by

- 12 — Offline subject checks on every party
