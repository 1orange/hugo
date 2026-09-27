# 05 — Czech companies

Type: AFK
Status: ready-for-agent
User stories: 25, 30

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

Some of her clients are Czech companies, filed in the same Drive layout and processed the same way.
This slice makes the profile country-aware (ADR 0018).

End to end: choosing Czech Republic as the country searches **ARES**
(`ares.gov.cz/ekonomicke-subjekty-v-be/rest`) by folder name or IČO instead of RPO and RÚZ. A Czech
profile has IČO and DIČ, and **the Czech DIČ (`CZ…`) is the VAT ID** — there is no separate IČ DPH
field, and ARES returns the DIČ only when the company is VAT-registered.

The profile's country sets the company's **home currency**, EUR or CZK. The existing
`nonEurCurrency` flag becomes "not the company's home currency", so a CZK document of a Czech
company is normal and a EUR one is the foreign one.

## Acceptance criteria

- [ ] The profile's country can be Slovakia or Czech Republic
- [ ] A Czech profile is set up from ARES search results by name or IČO, through the same `CompanyRegister` port with its own adapter and fake
- [ ] A Czech profile holds IČO and DIČ; the DIČ serves as the VAT ID and no IČ DPH field is shown
- [ ] A company's home currency follows its country
- [ ] The foreign-currency flag compares against the home currency: CZK on a Czech company is not flagged, EUR is
- [ ] Existing Slovak behaviour is unchanged
- [ ] E2E: set up a Czech profile from fake ARES results and see a CZK document shown without the foreign-currency warning

## Blocked by

- 04 — Company profile for Slovak companies
