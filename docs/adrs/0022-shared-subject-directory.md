# ADR 0022 — A subject directory shared by all client companies

Date: 2026-11-11
Status: Accepted. Amends ADR 0018 (registers per subject) and ADR 0019 (partner details come from the
directory first). Introduced by PRD 0004.

## Context

Until now every piece of data Hugo kept belonged to exactly one client company. Even the Omega
partner list (`partners`) is keyed by company, country and IČO: when two clients both buy fuel from
Slovnaft, Hugo stores Slovnaft twice and asks the registers about it twice.

PRD 0004 checks the integrity of every party on every document (ADR 0018 amendment). Doing that with a
register call per document is slow — RPO answers in 5–8 s — and fragile: an outage would leave every
document unverified. Most counterparties recur: the same few hundred suppliers appear across clients
month after month. What Hugo learns about one of them is equally true for every client.

## Decision

**One directory of subjects, shared across all client companies.**

- **Key:** `(country, IČO)`. The country stays in the key so that a Slovak and a Czech company sharing
  eight digits never merge (ADR 0018). A foreign subject without a Slovak or Czech IČO is keyed by its
  normalised VAT ID.
- **Content:** current legal name and former names from the register; the names it is printed under
  on documents (aliases, with counts); DIČ; IČ DPH; VAT-group membership where known; address;
  register status (active, dissolved) and VIES status; the source of each value (`register`, `vies`,
  `manual`); `verifiedAt` and `lastSeenAt`.
- **Resolution:** a party resolves by IČO, then VAT ID, then an exact alias. An unknown or stale
  subject is fetched from the `CompanyRegister` and `VatRegister` ports **on the worker**, with one
  lookup in flight per key across replicas (Redis, ADR 0021) and a rate limit. Pages read only the
  directory.
- **Freshness:** register data older than a configurable age (default 30 days) is refreshed on the
  next sighting, in the background.
- **Manual corrections win.** A field an accountant corrects is marked `manual` and never overwritten
  by a refresh; a fresh register answer that disagrees becomes a finding on the subject.
- **Client companies are subjects too**, linked through their profile's IČO, so a client invoicing
  another client resolves to the same subject on both sides. Where profile and directory disagree, the
  **profile wins** and the directory entry is flagged — the profile remains the source of roles.
  *(Amended 2026-11-16: the profile is the subject itself, so there is nothing to disagree with.)*
- **What the directory may fill on a document:** only **missing** fields of a party whose IČO or VAT ID
  matched a subject, shown with provenance `directory`. A printed value that disagrees is never
  replaced; it produces an integrity finding.
- **The Omega export** reads partner name, address and DIČ from the directory first and falls back to
  the registers only for unknown or stale subjects. The per-company `partners` table stays as the
  record of what was exported for each client.

## Consequences

- The first data shared across clients. A correction made while working on one client improves every
  other client's documents — which is the point, and also means a wrong manual correction spreads.
  Corrections are therefore visible on the directory screen with their source, and the referencing
  documents are listed so their impact can be judged.
- Integrity verdicts for known subjects are instant and survive register outages.
- Register load falls from one lookup per document (or per export line) to one per subject per
  refresh period.
- A dissolved or VAT-deregistered subject can be flagged on new documents, which no per-document
  check could cheaply do.
- The directory is not an Omega partner list and is not synchronised with Omega.

## Alternatives considered

- **Per-company directory (extend `partners`).** Smallest change, but duplicates every common
  supplier and repeats every lookup per client.
- **No cache: look up per document.** Always fresh, but slow, dependent on the registers being up, and
  hard on RPO.
- **Let the directory overwrite printed values.** Fills more fields, but replaces what the document
  says with what Hugo believes — the plausible-but-unprinted value ADR 0017 exists to prevent.

## Amendment, 2026-11-12 — a party with only an IČO

A party printing an IČO and nothing that tells its country (no DIČ, no IČ DPH) used to be left
unverified, as its key needs a country. It is now looked up in the Slovak register first, then the
Czech one, and resolves to the first subject that register holds; a fresh subject the directory
already holds answers without a call. An absence in the Slovak register creates no empty Slovak
subject (the IČO may be Czech). Neither register holding it is *not found*; a register that did not
answer while neither held it is *unavailable*. An IČO failing its checksum is not looked up.

## Amendment, 2026-11-16 — the subject is the client's profile

A client company's profile is no longer a second copy beside its subject. The subject linked to the
company (by country and IČO) *is* its profile: the profile form and its register lookup write that
subject, a company without one gets it created, and `company_profiles` is dropped. The Adresár is
the only copy, and it lists every client and partner with the data Hugo holds on each.

**"The profile wins" is withdrawn.** With one copy there is nothing to disagree with, so the
`profile-disagrees` finding and the `profile` source go. The readers of a client's identity (extraction
checks, document roles, the Omega export, subject verification) keep reading the profile, which now
is the subject's values.

Provenance is per field, as the subject's sources are: a value a register lookup filled is
`register` (the IČ DPH that VIES confirmed is `vies`), a value she typed is `manual`, and a manual
value is never overwritten by a refresh. A value the save does not change keeps the source it holds.
The migration sets the same provenance on the subjects it writes, from the profile's own register
source. A company's IČO that another company's profile already holds is refused rather than moved.

Each company has at most one linked subject (a unique index on `linked_company_id`). Changing a
company's IČO unlinks it from the old subject, which stays in the Adresár as an ordinary subject.
