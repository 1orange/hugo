# ADR 0023 — Company visibility follows Drive sharing

Date: 2026-11-23
Status: Accepted. Supersedes the 2026-11-11 amendment of ADR 0011 (*Moje firmy* as a personal
filter, every allowlisted user opens every company). Relates to ADR 0001 (Drive access), ADR 0022
(shared subject directory), PRD 0004 and PRD 0007.

## Context

Several accountants of the office use Hugo, and every allowlisted person could open every client's
month, profile, structure and documents. ADR 0011's 2026-11-11 amendment answered "which companies
do I work on" with *Moje firmy*: a list kept in each browser's storage. That is a view, not a
permission. Anyone could open a company that was not in her list, and the server never knew who
was assigned what.

Drive already records who may see a client's folder: the office shares each client folder, or the
accountants' group folder, with the Google accounts that work on it. The office wants that sharing to
decide what Hugo shows, so that one place controls access.

Two constraints from the service account (ADR 0001): Hugo can list a folder's permissions, but it
cannot expand a Google group (that needs the Admin or Cloud Identity API). Group grants are therefore
reported, not honoured.

## Decision

**A person sees a company when Drive says the company's folder is shared with them.** Drive is the only
source of who sees what. Hugo does not keep its own list of assignments.

- **The access snapshot** (PRD 0007, issue 08) holds each active company's principals as last read
  from Drive: type (`user`, `group`, `domain`, `anyone`), email or domain (lower-cased), role,
  inherited. A read replaces a company's principals wholesale. A failed read keeps the previous
  snapshot and records the error.
- **The rule** (`canSee`, pure): a `user` principal with the person's email, a `domain` principal for
  their domain, or an `anyone` principal. A `group` principal is not expanded and grants nothing.
- **Fail closed.** A company whose sharing has never been read is invisible to everyone. Before any
  company has a snapshot, *Firmy* says *Načítavam prístupy z Drive…* and shows no company, never all of
  them. When snapshots exist but none is visible to the person, it says *Nemáš prístup k žiadnej firme
  v Drive — požiadaj o zdieľanie priečinka klienta.*
- **One guard**, `src/lib/access/`:
  - `visibility.ts`: `visibleCompanies(email)` and `isCompanyVisible(email, companyId)`, each one
    query over the snapshot, with no Drive call. Also the pure `visibilityOf`, and the filters for the
    queue and live events.
  - `guard.ts`: the session side. `companyActionRefusal(companyId)` gives the refusal a server action
    returns, with the same message for a missing company and an invisible one.
- **Enforcement** (every place a company or its document is read or changed):
  - *Firmy*: the list, its summary counts and the month picker are computed over the visible
    companies only.
  - Pages `companies/[id]/[month]`, `profile`, `structure`, `activity`: not found.
  - Server actions that take a company id, including the document, closing and late-arrival
    actions, the profile saves and the Omega export preview and download: a refusal result, and
    nothing is read or written. A document's own action reaches the guard through the company id it
    carries.
  - API routes: `register-search` and `files/[id]/preview` answer 404.
  - The queue screen and the live event stream send only the visible companies' jobs and events.
  - The Adresár subject page lists only the visible companies' documents and companies that reference
    the subject.
- **The allowlist is unchanged** and still decides who may sign in (ADR 0011). Drive access never
  admits anyone. Nobody is let in by a share alone.
- **Office-wide screens stay office-wide**: the Adresár directory itself (its subjects and their
  register data, ADR 0022), and Settings, including the *Prístup z Drive* list that shows the office who
  can see each company.
- **Moje firmy is removed**: its module, its toggle and the star column, its browser storage and its
  tests. The accountant-group chips stay, and they appear only when the visible companies span more than
  one group. The group choice is still a personal view kept in this browser.

## Consequences

- The office decides who sees a client by sharing its folder in Drive, and Hugo follows within one
  sweep or *Obnoviť*. An accountant who is not shared a folder does not see the company, however she
  signs in.
- A person with no visible company gets an empty *Firmy* with an explanation, not an error.
- Every visibility check reads the snapshot and not Drive, so the guard adds a query per request, not
  a Drive call.
- **Rollout depends on the office.** On the live drive, the accountants see nothing until the office
  shares their group folders (or the client folders) with the Google accounts they sign in with (PRD
  0007, issue 09). Release waits for that approval.
- Group grants are invisible to Hugo's rule. An accountant reached only through a group does not see
  the company until the office shares it with her directly. The *Prístup z Drive* list reports these.
- The directory and Settings are not filtered, so every allowlisted person can read the subjects of
  every client. The references to companies (documents and their companies) are filtered. This is
  the PRD's choice for the directory, and it is the first place to look if the office later wants the
  directory restricted too.
- Queue and event screens filter when the connection opens and again on every queue snapshot and
  keep-alive. A revoked share stops arriving within the keep-alive interval (20 s).

## Alternatives considered

- **Keep *Moje firmy*, server-side.** An assignment table filled by the accountants. It is a second
  list that can disagree with Drive, and the office would still have to share the folder for Drive
  itself to work. Rejected: Drive is already the place the office manages access.
- **Expand groups through the Admin or Cloud Identity API.** Accurate for group members, but it needs
  a credential with directory scopes that Hugo does not have and that ADR 0001 keeps out of the box.
  Left for a later ADR if the office needs group grants to admit people.
- **Restrict by Drive's own access, asking Drive per request.** Always current, but one Drive call per
  company per page, and it would make every page depend on Drive being up. The snapshot is read on each
  poll, on *Obnoviť* and when the change log names a company or group folder.
- **Filter only the *Firmy* list.** Hides the companies but leaves month, profile and document URLs
  open to anyone who has the id. Rejected: the guard has to sit where the data is read.
