# 01 — A client company's profile is its Adresár subject

Type: AFK
Status: open

## What to build

Today a client company's identity lives in two places:

- its **company profile** (`company_profiles`: legal name, address, IČO, DIČ, IČ DPH, country);
- its **subject** in the shared Adresár (`subjects`), linked to it by IČO (`linkedCompanyId`).

Where they disagree, the profile wins and the subject is flagged (ADR 0022).

Make the Adresár the only copy. A client company's profile *is* the subject linked to it. The Adresár
becomes the table of every client and partner the office has seen, with the data Hugo holds on each.

- **Reading:** every reader keeps calling `getCompanyProfile(companyId)` with the same return shape. It
  now reads the subject linked to the company. Extraction checks, documents, party roles, the Omega
  export and subject verification do not change.
- **Saving:** the profile form, and its RPO/ORSR/ARES lookup, write the linked subject. A company
  without a subject gets one created (country + IČO), and it is linked. Changing the IČO re-links the
  company to the subject of the new IČO.
- **Provenance:** a value taken from a register lookup has source `register`; a value she types has
  source `manual`. Both use the subject's existing per-field sources and manual-field list. A register
  refresh never overwrites a manual field (unchanged rule).
- **Migration** (runs at startup, like every migration):
  - each existing profile row becomes its company's subject: an existing one by `(country, IČO)` is
    linked and updated, otherwise one is created;
  - `profile-disagrees` findings are removed, since there is no second copy to disagree with;
  - then `company_profiles` is dropped.

  Production has no profiles since the 2026-11-16 wipe, but the migration must handle the local data
  (3 profiles) and any test database.
- **Screens:** the company's profile page and the Adresár entry show and edit the same record. The
  Adresár marks client companies "Klient", with a link to the company, and can be filtered to clients.
- **ADR 0022 amendment (2026-11-16):** the subject is the source of truth for a client company, too.
  "The profile wins" is withdrawn.
- **Client sheet import** (0005/09): its write moves to the subject in slice 02. In this slice it keeps
  compiling, by writing through the new profile save.

## Acceptance criteria

- [ ] `getCompanyProfile` returns the linked subject's values in the current shape, and `null` for a company without a linked subject.
- [ ] Saving the profile creates or updates and links the subject. The IČO change re-links. Lookup values are `register` and typed values `manual`.
- [ ] The migration moves profiles into subjects (link existing, create missing), drops `profile-disagrees` findings and the table. An integration test runs it on a database holding both cases.
- [ ] The profile page and the Adresár edit the same record. The Adresár shows a "Klient" mark and a client filter.
- [ ] Every existing test passes, including the ones that read the client's profile in extraction checks, document roles and the Omega export. The e2e seed and the test-db helper no longer use `company_profiles`.
- [ ] ADR 0022 amended.

## Blocked by

None - can start immediately
