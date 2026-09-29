# ADR 0018 — A company profile from public registers, and roles derived from it

Date: 2026-09-27
Status: Accepted
Relates to: ADR 0017 (model extraction), ADR 0019 (Omega export), ADR 0013 (derive rather than
store), PRD 0001 slice 14 (per-company profiles, deferred), PRD 0002

## Context

An invoice names two parties, and **both parties' IČO, DIČ and IČ DPH appear in its text.** The
grounding check of ADR 0017 — every identifier must occur literally in the source — therefore
cannot catch a model that swaps them. Swapping supplier and customer is the classic mistake of a
small model, and the pdfjs line grouping makes it easier: on Omega-generated invoices the two
address columns interleave, producing lines such as `IČ DPH: SK2023141351 | Tomizo, s. r. o.`.

The direction also flips by folder. In `02 Prijaté faktúry` her client is the customer; in
`01 Vystavené faktúry` her client is the supplier. The only thing that says which party is her
client is her client's own identity, and **the `companies` table stores only a name and a Drive
folder.**

Her clients include **Czech companies**, filed in the same Drive layout and processed the same way.
That affects more than the register:

- **Tax identity differs.** A Slovak company has IČO, DIČ and IČ DPH. A Czech company has IČO and
  DIČ, and the Czech DIČ (`CZ…`) *is* the VAT ID; there is no separate IČ DPH.
- **IČO is not unique across the two countries.** A Slovak and a Czech company can share the same
  eight digits.
- **The home currency differs**, EUR against CZK, and with it what "foreign currency" means.
  Today's `nonEurCurrency` flag in `src/modules/document-fields.ts` assumes EUR.
- **Czech receipts carry no fiscal code** — EET was abolished in 2023 — so they all take the model
  path (ADR 0016, ADR 0017).

The data needed is public. Measured on 2026-09-27, with public companies rather than client names:

- **RPO** (Štatistický úrad), `api.statistics.sk/rpo/v1/search?fullName=…`, searches Slovak
  entities by name and returns IČO, name history and addresses. "Slovnaft" returns **54 matches**,
  former names and subsidiaries included, so a name search always ends with a person choosing.
- **RÚZ**, `registeruz.sk/cruz-public/api/…`, returns DIČ, current legal name and address for an
  IČO.
- **ARES**, `ares.gov.cz/ekonomicke-subjekty-v-be/rest/…`, searches Czech entities by name or IČO
  and returns the DIČ only when the company is VAT-registered.
- **Neither Slovak register carries IČ DPH, and it cannot be derived.** Slovnaft's DIČ is
  `2020372640`, but its receipt prints IČ DPH `SK7120001713`: it is registered as a VAT group, so
  "SK + DIČ" is wrong for exactly the companies where it looks most plausible.

None of the three needs a key.

## Decision

**Each company gets a profile, set up once, with a country.**

1. When the sweep finds a company folder with no profile, the dashboard marks it "profile missing".
   Extraction still runs; only roles wait.
2. Setup searches the right register by the **Drive folder name**, fuzzily, since folder names
   rarely match legal names: RPO for a Slovak company, ARES for a Czech one. She picks from the
   candidates — IČO, address, active or dissolved — or enters an IČO directly.
3. The app fills the legal name, address and DIČ from RÚZ or ARES.
4. **IČ DPH stays empty until she types it.** A pre-filled `SK` + DIČ would be the plausible wrong
   value ADR 0017 exists to prevent. For a Czech company the DIČ from ARES is the VAT ID.
5. The profile stays editable afterwards, for a name change or a dissolution.

**Roles are derived when a document is displayed, never stored** — the same principle that derives
cash versus card from the folder in ADR 0013:

- The model returns both parties without roles (ADR 0017).
- The party whose IČO matches the company's is her client; the other is the counterparty — the
  supplier in `02`, the customer in `01`. When a VAT ID is printed, its `SK` or `CZ` prefix must
  agree too, which settles cross-country IČO collisions.
- **Neither party matching is flagged, not guessed.** It is the signature of a misfiled document or
  someone else's invoice.
- **Without a profile, roles are empty and flagged.** There is no fallback to the model's opinion.

Because roles are computed at read time, a document extracted before its company had a profile
gets the right roles the moment the profile is saved, with no re-extraction.

**The profile's country sets the home currency**, EUR or CZK, and "foreign currency" means anything
else. VAT-rate checks use the **issuer's** country, since a Czech company can hold a Slovak receipt
and the reverse.

The `CompanyRegister` port — RPO and RÚZ for SK, ARES for CZ — is also how the export fills in a
**counterparty's** name, address and DIČ by IČO for Omega's partner list (ADR 0019), so the model
only has to get the IČO right, which grounding already verifies.

## Consequences

- The first real reason for per-company profiles, which PRD 0001 slice 14 deferred. The profile is
  deliberately small: identity and country, no settings.
- **Three more external dependencies**, all public registers, all used at setup and for partner
  enrichment rather than per document. Results are stored, so a register outage delays a new
  company's setup and nothing else.
- Supplier-versus-customer becomes a deterministic check with a stated failure mode, instead of a
  model output nobody can verify.
- A foreign counterparty with no Slovak or Czech IČO — Kaspersky in the Netherlands — has no
  register to enrich it. Its partner details come from the document alone.
- `nonEurCurrency` becomes "not the company's home currency", which changes a message on every CZK
  document of a Czech company from a warning to nothing.

## Alternatives considered

- **Let the model assign roles.** Cheapest, and exactly the failure small models are known for.
- **Infer the company's IČO** as the most frequent supplier IČO on its own issued invoices, then ask
  her to confirm. Clever, but fails for a company with no issued invoices yet, and a register search
  is one pick either way.
- **Type the profile by hand.** Always available as the fallback — an IČO entered directly — but the
  registers remove most of the typing and every transcription error in the DIČ.
- **Store roles on the document.** Goes stale when a profile is corrected, the same argument ADR
  0013 made against storing cash versus card.

## Amendment, 2026-09-29 — IČ DPH when VIES vouches for it, and the registers as they answer

The first real setup, SPRING.etc., spol. s r. o., ended with an empty IČ DPH she had to type, for a
company whose "SK" + DIČ is its IČ DPH. Decision 4 kept the field empty because that guess is wrong
for a VAT group member. VIES, the EU's check of a VAT ID against the member state's register, tells
the two apart — measured on 2026-09-29:

- `SK2023141351` (SPRING.etc., SK + its DIČ) is valid, registered to "SPRING.etc., spol. s r. o.";
- `SK2020372640` (Slovnaft, SK + its DIČ) is **invalid**: it is in a VAT group;
- `SK7120001713` (the group's number, printed on Slovnaft's receipts) is valid, named only "Group
  registration".

**Decision 4 now reads:** after a Slovak lookup the app asks VIES about SK + DIČ. IČ DPH is filled in
only when VIES says it is registered **and** to the same name as the register's, legal form aside
(register-search module); the profile's source is then `rpo+ruz+vies`. Invalid, another name, or
VIES not answering — the field stays empty, as before, with a line saying which. The value filled in
is a registration VIES confirms, not a plausible guess, so it is not the value ADR 0017 exists to
prevent. She still sees it and can change it before saving. VIES needs no key; it is asked once per
setup, never per document.

Two things about the registers themselves, found when setup failed on a real IČO:

- **RÚZ** refuses (HTTP 403, from its firewall) a list request without `zmenene-od`, and the list
  returns ids only; the name, address and DIČ come from a second request per id. An IČO can hold a
  live record beside withdrawn ones (`stav: "ZMAZANÉ"`), which are skipped.
- **RPO** returns every attribute as a history — the current entry has no `validTo` — and matches
  the name as one literal substring, former names included, capped at 500 entities, in 5–8 s:
  "spring" finds 123, "spring etc" none. The setup form therefore searches as she types, asks again
  by the longest word when a query of several finds nothing, ranks live companies and closer names
  first, and keeps each answer for ten minutes. A register that fails is a message in the form, and
  in the Omega export a counterparty keeps the document's own name and DIČ.
