# 12 — Offline subject checks on every party

Type: AFK
Status: done
User stories: 24–27, 37, 40

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The tracer bullet for subject integrity (ADR 0018 amendment). A pure subject-integrity module takes a
party identity (name, IČO, DIČ, IČ DPH) plus optional register and VIES answers, and returns a verdict —
`verified`, `notice`, `mismatch`, `unverifiable` or `unavailable` — with findings naming field,
problem, printed value and authoritative value. This slice implements the offline checks, which always
run: IČO mod-11 checksum (SK and CZ), Slovak DIČ (10 digits), Slovak IČ DPH (`SK` + 10 digits,
divisible by 11), Czech DIČ (`CZ` + 8–10 digits), and `SK` + DIČ ≠ IČ DPH as a *notice* (VAT groups).
A party without IČO or with a foreign VAT ID is *nedá sa overiť*, not flagged. The client's own party
is checked against the company profile, not the registers, reusing party-role matching.

The fields panel shows the verdict next to each party fieldset with its findings in Slovak, recomputed
live while the accountant edits an identity field. The interface already accepts register and VIES
answers so slices 13 and 14 only add inputs.

## Acceptance criteria

- [ ] An IČO with a wrong check digit is a mismatch; a correct one passes.
- [ ] Malformed DIČ or IČ DPH, and a Slovak IČ DPH not divisible by 11, are mismatches.
- [ ] `SK` + DIČ ≠ IČ DPH is a notice, never a mismatch.
- [ ] Foreign parties and parties without identifiers are *nedá sa overiť*.
- [ ] The client party is checked against the profile.
- [ ] The badge updates as identity fields are edited.
- [ ] Table-driven unit tests cover every rule for SK and CZ; a fields-panel UI test covers badges and live recompute.

## Blocked by

None - can start immediately
