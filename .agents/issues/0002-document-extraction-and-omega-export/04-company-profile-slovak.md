# 04 — Company profile for Slovak companies

Type: AFK
Status: ready-for-agent
User stories: 24, 26, 29, 31

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

Her client gets an identity (ADR 0018). Today a company is a name and a Drive folder; after this
slice it has a profile — country, legal name, address, IČO, DIČ, IČ DPH — set up once from the
public register.

End to end: a company without a profile shows **profile missing** on the chase list, and extraction
carries on regardless. Setting it up searches **RPO** (`api.statistics.sk/rpo/v1/search`) by the
Drive folder name, fuzzily, because folder names rarely match legal names. She sees the candidates
with IČO, address and active or dissolved status — "Slovnaft" alone returns 54 — and picks one, or
enters an IČO directly. **RÚZ** (`registeruz.sk/cruz-public/api`) fills the legal name, address and
DIČ. **IČ DPH stays empty until she types it**: VAT groups break "SK + DIČ" (Slovnaft's DIČ is
`2020372640`, its IČ DPH `SK7120001713`), so a pre-filled value would be exactly the plausible wrong
value ADR 0017 bans.

The `CompanyRegister` port has one adapter per register and a fake. Register results are stored, so
an outage only delays setting up a new company. The profile stays editable. This slice supports
Slovak companies; slice 05 adds Czech ones, so the country is stored from the start.

## Acceptance criteria

- [ ] A company profile is stored with country, legal name, address, IČO, DIČ, IČ DPH, register source and when she saved it
- [ ] The chase list marks companies without a profile, and extraction still runs for them
- [ ] Setup searches RPO by the Drive folder name and lists candidates with IČO, address and active or dissolved status
- [ ] She can pick a candidate or enter an IČO directly
- [ ] Legal name, address and DIČ are filled from RÚZ by IČO
- [ ] IČ DPH is never pre-filled; she types it, and its format is checked
- [ ] The profile can be edited later, and every save records an event
- [ ] `CompanyRegister` has a hand-written fake; no test calls a real register
- [ ] The UI is Slovak throughout (ADR 0015)
- [ ] E2E: set up a profile from fake search results, reload, and see it persist and the chase-list marker disappear

## Blocked by

None - can start immediately
