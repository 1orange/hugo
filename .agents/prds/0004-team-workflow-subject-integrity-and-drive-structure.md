# PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure

Status: ready-for-agent
Primary users: several accountants of one office, each responsible for a subset of client companies
Continues: PRD 0003 (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)
ADRs: amends ADR 0005 (month close), ADR 0006 (Drive mutations), ADR 0007 (canonical folder names),
ADR 0011 (authentication), ADR 0017 (advance-settled invoices), ADR 0018 (registers per subject);
introduces ADR 0022 (shared subject directory). All amendments are dated 2026-11-11.

> This PRD comes from the first feedback round with the office. Hugo stops being a one-person tool:
> each accountant can narrow the company list to their own clients. The document workbench gains a
> one-click supplier/customer swap and a register-backed integrity check for every party, backed by
> a shared directory of subjects. The app stops creating Drive folders — the office pre-creates a
> whole year — and instead reports every place where a company's Drive strays from the agreed
> structure.

---

## Problem Statement

**More than one accountant now uses Hugo.** The allowlist already admits several people, but the
company list (*Firmy*) shows every client to everyone. An accountant responsible for eight of forty
clients has to scan the whole table every morning, and the summary figures (*doklady čakajú*,
*bez bankového výpisu*, *celý mesiac nič nenahralo*) count other people's work, so they never reach
zero for anyone.

**Swapped parties are tedious to fix.** Supplier/customer confusion is the classic extraction
mistake (ADR 0018). When the model puts the parties on the wrong sides, the accountant has to retype
or cut-and-paste eight fields (name, IČO, DIČ and IČ DPH for both *Dodávateľ* and *Odberateľ*) to
correct one decision.

**A party's identity can be internally inconsistent and nothing says so.** Grounding (ADR 0017)
proves that every printed identifier occurs in the document, but not that the identifiers belong
together. A party can end up with one company's name and another company's IČO — the interleaved
address columns on Omega invoices make this easy — or with a DIČ that does not belong to the IČO, or
an IČ DPH that is not registered. Hugo already knows how to ask RPO, RÚZ, ARES and VIES who an IČO or
a VAT ID belongs to, but only uses them when a company profile is set up and when the Omega export
fills partner addresses. Inconsistent subjects reach Omega's partner list, where they are much harder
to correct.

**The same counterparties are looked up again and again.** Slovnaft, Orange, O2, the landlord, the
accounting software vendor: most clients buy from the same few hundred subjects. Each one is
re-extracted from scratch on every document and re-looked up in the registers on every export, per
client company. Nothing Hugo has learnt about a subject is reused.

**Advance-settled invoices come out as zero.** The office calls them *zálohové (preddavkové)
faktúry*: a final invoice from which an advance already paid is deducted, so the amount due is
`0,00`. Hugo reads one total per document, so the zero (or the advance-cancelled recap) is what it
extracts, while the accountant needs the invoice's real base, VAT and total. The benchmark corpus has
both layouts: negative `Zál. daň. dokl. základ 23% | -32,51 | DPH 23% | -7,48` rows that cancel the
recap to `Základ celkom 0,00 | Celkom DPH 0,00`, and a full recap `Celkom | 364,65 | 83,87 | 448,52`
followed by `Celkom uhradených záloh: 448,52` and `Celkom k úhrade vrátane DPH | 0,00`. PRD 0003's
derivations make it worse: the VAT summary sums the cancelling rows to zero, and the single-rate VAT
inference (total − base) on such a document invents a negative VAT.

**The app creates folders the office no longer wants it to create.** The office pre-creates the full
year of month folders for every client at the start of the year. Hugo still scaffolds month
subfolders on every sweep and creates the next month folder when a month is closed (ADR 0005). Worse,
the open month is derived as *the newest month without a close*: with `2026_01` … `2026_12` all
present, Hugo considers December the open month in November. That is exactly the failure ADR 0005
predicted for "newest folder is open" once folders exist ahead of time.

**Hugo's folder vocabulary no longer matches the office's.** The agreed structure (snapshot in
`.agents/ctx/gdrive/structure`) is:

```
<shared drive root>
└── Konto <company>                 one folder per client, always prefixed "Konto "
    ├── 2024                        closed past years, archived as a single folder
    ├── 2025
    ├── 2026_01 … 2026_12           the current year, all twelve months pre-created
    │   ├── 01 Vystavené faktúry
    │   ├── 02 Prijaté faktúry
    │   ├── 03 Bankové výpisy
    │   ├── 04 Platby hotovosťou
    │   ├── 05 Platby kartou
    │   ├── 06 Iné doklady
    │   └── 07 Mzdy
```

Hugo's canonical list still says `04 Bločky_hotovosť` and `05 Bločky_firemná karta`, it shows the
`Konto ` prefix as part of the company name (and searches the registers with it), and it silently
ignores anything at company level that is not a `YYYY_MM` folder. When a client's Drive drifts —
a missing month, a missing or misspelled subfolder, a company folder without the prefix, files
dropped straight into the company folder — nobody finds out until a document goes missing.

## Solution

1. **Moje firmy.** Each accountant marks the companies assigned to them on the *Firmy* page. The
   assignment lives in the browser's local storage, per signed-in user, so it survives reloads and
   restarts without any server-side concept of ownership. A toggle switches between *Moje firmy* and
   *Všetky firmy*; the summary strip counts only what is shown.
2. **Vymeniť strany.** A single button between the *Dodávateľ* and *Odberateľ* fieldsets swaps the
   two parties wholesale — all four identity fields with their provenance and integrity verdicts —
   as one recorded correction. Clicking it again swaps back.
3. **Subject integrity.** Every party on a document gets an integrity verdict: offline checks first
   (IČO checksum, DIČ and IČ DPH format, Slovak VAT ID divisibility, DIČ ↔ IČ DPH agreement), then
   the registers (IČO → legal name and DIČ from RÚZ/ARES; IČ DPH → validity and holder from VIES).
   The workbench shows *Overené* or exactly what disagrees ("Názov nezodpovedá IČO — v registri:
   Slovnaft, a.s."), and offers to take the register's values with one click. Nothing is overwritten
   on its own.
4. **Adresár subjektov.** Every subject Hugo verifies is kept in one shared directory keyed by
   country and IČO (or by VAT ID for foreign subjects without an IČO). The directory caches register
   answers, remembers which names a subject is printed under, makes integrity verdicts instant for
   known subjects, fills safe missing fields, and feeds the Omega export's partner details. Accountants
   can browse, search and correct it.
5. **The office owns the folders.** Hugo no longer creates month folders or month subfolders. Future
   months are dormant: the open month is the newest unclosed month that is not in the future.
6. **Štruktúra Drive.** Every sweep checks each company against the agreed structure and records
   deviations. The *Firmy* list shows a badge on companies that stray, and a per-company structure
   view lists each deviation in plain Slovak with what to do about it. Near-miss folder names keep
   the existing one-click rename repair (ADR 0007); everything else is reported for a person to fix
   in Drive.
7. **Zálohové (preddavkové) faktúry.** An invoice with an advance deducted keeps its real values:
   the total, base and VAT of the supply. The deducted advance (with the advance documents it
   references) and the amount due are kept as separate, visible fields, and the cancelling recap rows
   are treated as settlement rows rather than VAT rows. A zero amount due is never booked as the total.

## User Stories

### Moje firmy (assigned companies)

1. As an accountant, I want to mark a company as mine directly in the *Firmy* table, so that I can
   build my list without visiting a settings screen.
2. As an accountant, I want to unmark a company, so that a client handed over to a colleague leaves
   my list.
3. As an accountant, I want a *Moje firmy / Všetky firmy* toggle above the table, so that I can switch
   between my work and the whole office.
4. As an accountant, I want the toggle position remembered, so that the page opens the way I left it.
5. As an accountant, I want my assignment to survive page reloads, browser restarts and app
   deployments, so that I set it up once.
6. As an accountant sharing a computer with a colleague, I want my assignment kept separately from
   theirs, so that signing in as myself shows my companies and not theirs.
7. As an accountant, I want the summary figures (*doklady čakajú*, *bez bankového výpisu*,
   *celý mesiac nič nenahralo*, *pripravené na uzavretie*, *bez profilu firmy*, *odchýlky štruktúry*)
   to count only the companies shown, so that my numbers can reach zero.
8. As an accountant, I want the month picker to keep working together with the filter, so that I can
   look at my companies in a past month.
9. As an accountant who has not assigned anything yet, I want *Moje firmy* to tell me how to start
   instead of showing an empty table, so that I am not confused into thinking clients disappeared.
10. As an accountant, I want a count of how many companies are hidden by the filter, so that I never
    forget the filter is on.
11. As an accountant, I want a company that disappears from Drive to drop out of my list without an
    error, so that stale assignments do not break the page.
12. As an accountant, I want a newly discovered company to appear in *Všetky firmy* but not in
    *Moje firmy* until I take it, so that new clients are visible to everyone and assigned on purpose.
13. As an accountant, I want the page to work normally if my browser blocks local storage, so that a
    private window still shows all companies.

### Vymeniť strany (swap parties)

14. As an accountant, I want one button that swaps *Dodávateľ* and *Odberateľ*, so that I fix a
    swapped extraction with one click instead of retyping eight fields.
15. As an accountant, I want the swap to move name, IČO, DIČ and IČ DPH together, so that no field is
    left behind on the wrong side.
16. As an accountant, I want each moved value to keep its provenance badge (*z dokladu*, *z profilu*,
    *vypočítané*, *upravené*), so that I still know where each value came from.
17. As an accountant, I want a second click to restore the original sides, so that a mistaken swap is
    harmless.
18. As an accountant, I want the role warnings (*Ani jedna strana nezodpovedá profilu klienta*) to
    update immediately after a swap, so that I see whether the swap fixed the problem.
19. As an accountant, I want the swap to be saved like any other correction of mine and to survive
    re-rendering and draft rebasing, so that it is not lost when the document is refreshed.
20. As an accountant, I want the swap recorded in the activity log, so that a colleague can see why
    the parties differ from the extraction.
21. As an accountant, I want the button disabled for exported or closed-month documents, so that I
    cannot change what has already been booked. *(Amended 2026-11-12: a decided document stays
    swappable, as its fields stay editable — a misread is mended after the decision. The same holds
    for the advance-settlement toggle and* Prevziať z registra*.)*
22. As an accountant, I want a keyboard shortcut for the swap, so that I can fix a batch of invoices
    without reaching for the mouse.
23. As an accountant, I want the swap available on receipts and other documents that show both
    parties, so that the behaviour is consistent.

### Subject integrity

24. As an accountant, I want each party to show an integrity verdict next to its fieldset, so that I
    see at a glance whether the subject is consistent.
25. As an accountant, I want an IČO with an invalid checksum flagged immediately and offline, so that
    a mistyped or misread digit is caught even when registers are down.
26. As an accountant, I want a malformed DIČ or IČ DPH flagged (wrong length, wrong prefix, Slovak
    IČ DPH not divisible by 11), so that obvious misreads are caught before any lookup.
27. As an accountant, I want to be told when a Slovak IČ DPH does not equal `SK` + DIČ, as a notice
    rather than an error, so that VAT-group members such as Slovnaft are not wrongly rejected.
28. As an accountant, I want the party's name compared with the register's legal name for its IČO,
    ignoring legal-form spelling, case and diacritics, so that "SLOVNAFT a.s." and "Slovnaft, a. s."
    count as the same subject.
29. As an accountant, I want a name that matches a former name in the register accepted with a note,
    so that older invoices from renamed companies are not flagged as wrong.
30. As an accountant, I want a name that belongs to a different company than the IČO flagged with the
    register's name shown, so that I can tell which value is wrong.
31. As an accountant, I want the DIČ compared with the register's DIČ for the IČO, so that a DIČ copied
    from the other party is caught.
32. As an accountant, I want the IČ DPH checked against VIES, so that I know whether the VAT number is
    registered and to whom.
33. As an accountant, I want a VAT-group IČ DPH (VIES holder "Group registration") accepted when the
    directory knows the subject belongs to that group, so that fuel receipts do not raise false alarms.
34. As an accountant, I want a button *Prevziať z registra* that fills the register's name, DIČ and
    IČ DPH into a flagged party, so that I can correct a subject in one click.
35. As an accountant, I want values taken from the register shown with their own provenance badge
    (*z registra*), so that I can tell them apart from what the document printed.
36. As an accountant, I want my typed value never to be overwritten by a register answer, so that my
    decision stays authoritative (ADR 0010).
37. As an accountant, I want a party with no register (a foreign subject, or a person without IČO)
    marked *nedá sa overiť* rather than flagged, so that legitimate foreign suppliers are not noise.
38. As an accountant, I want an unreachable register shown as *overenie nedostupné* with the offline
    checks still applied, so that a register outage never blocks my work.
39. As an accountant, I want verification to run in the background after extraction, so that opening
    a document is never slowed by register latency.
40. As an accountant, I want the verdict to refresh after I edit an identity field, so that I can see
    my correction confirmed.
41. As an accountant, I want the document rail to mark documents with a subject integrity problem, so
    that I can find them without opening every invoice.
42. As an accountant, I want the Omega export to warn about documents whose parties failed integrity,
    so that I do not import an inconsistent partner into Omega.
43. As an accountant, I want my client's own side checked against the company profile rather than the
    registers, so that the profile stays the single source of truth for the client (ADR 0018).

### Adresár subjektov (subject directory)

44. As an accountant, I want every subject Hugo has verified kept in a shared directory, so that the
    office builds up knowledge once instead of per client.
45. As an accountant, I want a known subject's verdict shown instantly without a register call, so
    that review is fast for the suppliers we see every month.
46. As an accountant, I want a party with a known IČO but a missing DIČ or IČ DPH filled from the
    directory with a *z adresára* badge, so that I do not retype data the office already verified.
47. As an accountant, I want the directory to remember the names a subject is printed under, so that
    trade names ("CENTRAL Bratislava") are recognised as the same subject.
48. As an accountant, I want to browse and search the directory by name, IČO, DIČ or IČ DPH, so that I
    can look a partner up without opening a document.
49. As an accountant, I want to see which companies and documents reference a subject, so that I can
    judge the impact of a correction.
50. As an accountant, I want to correct a subject in the directory (for example an IČ DPH VIES does not
    know yet), so that my colleagues benefit from the correction.
51. As an accountant, I want a corrected subject marked as manually confirmed and protected from being
    overwritten by a later register refresh, so that a deliberate correction sticks.
52. As an accountant, I want register data refreshed when it is older than a set age, so that renames,
    dissolutions and VAT deregistrations are noticed.
53. As an accountant, I want a dissolved or VAT-deregistered subject flagged on new documents, so that
    I notice an invoice from a company that should not be issuing them.
54. As an accountant, I want the Omega export to take partner name, address and DIČ from the directory
    when it has them, so that the export works during a register outage and makes fewer calls.
55. As an accountant, I want a Slovak and a Czech subject with the same eight-digit IČO kept apart, so
    that cross-country collisions never merge two companies (ADR 0018).
56. As an accountant, I want our own client companies to appear in the directory linked to their
    profile, so that a client invoicing another client is recognised on both sides.

### Pre-created Drive folders and the open month

57. As an accountant, I want Hugo to stop creating month folders and month subfolders, so that the
    structure the office prepared in January is the only structure.
58. As an accountant, I want closing a month to only close it, without creating the next month in
    Drive, so that closing has no side effects in Drive.
59. As an accountant, I want the open month to be the newest unclosed month that is not in the future,
    so that pre-created December does not hijack the dashboard in November.
60. As an accountant, I want future months hidden from the month picker until they start, so that the
    picker does not list eleven empty months in January.
61. As an accountant, I want documents a client uploads early into a future month still discovered and
    shown in that month once it starts, and flagged on the current month as *nahraté do budúceho
    mesiaca*, so that an early upload is not lost.
62. As an accountant, I want late-arrival moves (ADR 0006) to require the destination slot to exist and
    to report a missing slot instead of creating it, so that Hugo never creates folders.
63. As an accountant, I want the company name shown without the `Konto ` prefix everywhere in Hugo,
    so that the list reads "SPRING.etc." rather than "Konto SPRING.etc.".
64. As an accountant, I want the profile setup to search the registers by the company name without the
    `Konto ` prefix, so that register search finds the company.
65. As an accountant, I want the canonical subfolder names updated to the office's
    (`04 Platby hotovosťou`, `05 Platby kartou`), with the settings impact preview showing what changes,
    so that existing folders are recognised under the new convention.

### Štruktúra Drive (structure conformance)

66. As an accountant, I want a badge on each company that strays from the agreed structure, with the
    number of deviations, so that I see drift on the main page.
67. As an accountant, I want a per-company structure view that lists each deviation with its Drive path
    and what to do about it, so that I can fix it quickly in Drive.
68. As an accountant, I want a company folder without the `Konto ` prefix reported, so that the
    shared drive stays consistent.
69. As an accountant, I want a missing month folder of the current year reported, so that I know
    before a client tries to upload into it.
70. As an accountant, I want a missing canonical subfolder in a current-year month reported, so that
    documents have somewhere to go.
71. As an accountant, I want misspelled subfolders to keep the existing one-click rename repair, so
    that typos cost one click (ADR 0007).
72. As an accountant, I want unrecognised folders at company and month level reported, so that a
    client's own folder (`04 Pokladňa`) is a decision someone makes rather than an invisible pocket.
73. As an accountant, I want two folders claiming the same month (`2026_05` twice) reported, so that
    documents are not split across duplicates.
74. As an accountant, I want files placed directly in a company folder or a year archive folder
    reported, so that misplaced uploads are noticed.
75. As an accountant, I want past-year archive folders (`2024`, `2025`) accepted without inspecting
    their contents, so that archived years do not produce noise.
76. As an accountant, I want a month folder of a past year left in the company folder (`2025_11` in
    2026) reported as *patrí do archívu 2025*, so that the year-end archive step is not forgotten.
77. As an accountant, I want deviations to disappear on the next sweep once someone fixes them in
    Drive, so that the list reflects Drive rather than a to-do list I must maintain.
78. As an accountant, I want the structure check to cover every company, including ones without a
    profile, so that new clients are checked from day one.
79. As an accountant, I want the *Firmy* summary strip to count companies with structure deviations,
    respecting the *Moje firmy* filter, so that I see the drift I am responsible for.
80. As an accountant at the start of a new year, I want companies whose new year has not been created
    yet reported as one deviation per company (*chýba rok 2027*), not twelve, so that the report stays
    readable.

### Zálohové (preddavkové) faktúry (advance-settled invoices)

81. As an accountant, I want an invoice whose amount due is zero because an advance was deducted to
    show its real total, base and VAT, so that I book the value of the supply and not zero.
82. As an accountant, I want the negative advance-deduction rows (`Zál. daň. dokl. základ …`) kept out
    of *DPH podľa sadzby*, so that the VAT summary shows the supply's VAT instead of zero.
83. As an accountant, I want the deducted advance shown as its own field (*Odpočet zálohy*), so that I
    can see how the zero came about.
84. As an accountant, I want the amount due shown as its own field (*K úhrade*), so that I can tell a
    settled invoice from an unpaid one.
85. As an accountant, I want the advance documents the invoice refers to (`ZDD15873826`,
    `Zálohové doklady č. 5926010455`) listed, so that I can pair them with the earlier advance in Omega.
86. As an accountant, I want a clear hint *Vyúčtovanie zálohy — k úhrade 0,00, účtuje sa plná suma*,
    so that I am not surprised that the total differs from the amount due.
87. As an accountant, I want the total taken from a printed gross total when the document has one, and
    otherwise computed from the supply rows and marked *vypočítané*, so that I know whether the value
    was printed or derived.
88. As an accountant, I want a document with a zero total but non-zero supply rows never accepted
    silently, so that a misread zero is always flagged.
89. As an accountant, I want the arithmetic check to compare base + VAT with the supply total and to
    accept a zero amount due, so that settled invoices are not reported as arithmetic errors.
90. As an accountant, I want *total − advance = amount due* checked as well, so that a misread advance
    amount is caught.
91. As an accountant, I want the single-rate VAT inference to stay out of settled invoices, so that it
    never derives a negative or invented VAT from total minus base.
92. As an accountant, I want the Omega export to carry the real values of a settled invoice, so that
    the import into Omega matches the supply.
93. As an accountant, I want to override the detection (mark an invoice as not settled by an advance,
    or as settled), so that an unusual layout never forces wrong values on me.
94. As an accountant, I want documents already read before this change re-read automatically in open
    months, so that existing zero-total invoices are corrected without manual work.
95. As an accountant, I want settled invoices recognised on received (`02`) and issued (`01`) invoices
    alike, so that both directions are booked correctly.

## Implementation Decisions

### Assigned companies (*Moje firmy*)

- Assignment is **client-only state** in `localStorage`, deliberately not in cookies and not in the
  database. There is no server-side ownership, permission or audit of assignment. Cookies were
  rejected because they travel with every request and expire; the database was rejected because the
  office asked for a lightweight personal filter, not an assignment workflow.
- The storage key is namespaced by the signed-in user's email, so colleagues sharing a browser keep
  separate lists. The value is a versioned JSON object holding the set of assigned companies and the
  filter mode.
- Companies are identified by their **Drive folder id**, not the database id. It is stable across
  database rebuilds and replicas (ADR 0021) and is already the company's natural key.
- A pure **assigned-companies module** owns parsing, versioning, tolerant recovery from corrupt or
  foreign values (treated as empty, never thrown), adding and removing, and filtering a list of
  company summaries. Unknown ids are ignored, not pruned, so a temporarily missing company does not
  lose its assignment.
- The *Firmy* table keeps server rendering for data; a thin client wrapper applies the filter and
  recomputes the summary with the existing pure chase-list summariser over the visible rows. Server
  work that is not per-user (sweep, warming extraction for open months) is unaffected by the filter.
- All storage access is wrapped so that a blocked or throwing `localStorage` degrades to *Všetky
  firmy* with assignment controls disabled and a short explanation.
- Before hydration the page renders *Všetky firmy*; the filter applies after hydration without layout
  jump in the summary strip.

### Swapping parties

- A pure **party-swap module** takes the document draft and its per-field provenance and returns both
  with supplier and customer exchanged: name, IČO, DIČ, IČ DPH and their provenance move together.
  It is an involution: swapping twice yields the original exactly.
- The swap is persisted as the accountant's correction, through the existing confirmed-values path,
  so it outranks extraction and survives draft rebasing (ADR 0010, PRD 0003's provenance rules).
  Provenance is carried over rather than reset to *upravené*, because the values themselves did not
  change; the activity log records that the sides were swapped.
- A new user event, `PartiesSwapped`, is appended to the event log (ADR 0012) and rendered in the
  activity log.
- Roles remain derived at read time from the company profile (ADR 0018). The swap changes what is on
  each side; it does not store a role. Role warnings are recomputed from the swapped values.
- The control sits between the two fieldsets in the fields panel, labelled *Vymeniť strany*, with a
  keyboard shortcut consistent with the workbench's existing single-key shortcuts. It is disabled
  whenever the fields are read-only.

### Subject integrity

- A pure **subject-integrity module** is the core of this PRD. Interface, in essence:
  - input: a party identity (name, IČO, DIČ, IČ DPH), the document's country context, and optionally
    a register record and a VIES answer (both already fetched, possibly absent or failed);
  - output: a verdict — `verified`, `notice`, `mismatch`, `unverifiable` or `unavailable` — plus a
    list of findings, each naming the field, the kind of problem, the printed value and the
    authoritative value where one exists.
- Offline checks run first and always: Slovak/Czech IČO mod-11 checksum; Slovak DIČ shape (10 digits);
  Slovak IČ DPH shape (`SK` + 10 digits) and divisibility by 11; Czech DIČ shape (`CZ` + 8–10 digits);
  `SK` + DIČ ≠ IČ DPH reported as a *notice*, never a mismatch, because VAT groups exist (ADR 0018).
- Register checks compare the printed name with the register's current legal name and former names
  using the existing core-company-name normalisation from register search (legal form, punctuation,
  case and diacritics folded away). A former-name match is a *notice*. DIČ is compared exactly after
  normalisation.
- VIES checks: invalid → mismatch; valid with a different holder name → mismatch; valid with holder
  "Group registration" → verified only when the directory records the subject as a member of that
  VAT group, otherwise a notice.
- The client's own party is checked against the **company profile**, never the registers, and reuses
  the existing client-matching logic of party roles. Profile and directory must not disagree; if they
  do, the profile wins and the directory entry is flagged.
- Verification is **asynchronous**: after extraction (and after any edit of an identity field) the
  worker resolves each counterparty through the subject directory and stores the verdict on the
  document's payload. The web replica never calls a register while rendering. The workbench shows
  the stored verdict and recomputes offline checks live while the accountant types.
- *Prevziať z registra* writes the authoritative values as the accountant's confirmed values with a
  new provenance, `register`, alongside the existing `extracted`, `confirmed`, `profile` and
  `derived`. A companion provenance `directory` marks fields filled from the directory for a known
  subject. Both are shown with their own badges and both yield to anything the accountant typed.
- Fields filled from the directory are restricted to **missing** values on a party whose IČO (or
  VAT ID) matched a directory subject. A conflicting printed value is never replaced; it produces a
  finding instead. This keeps ADR 0017's guarantee that nothing plausible-but-unprinted is slipped in
  silently: directory values are visibly marked and come from a verified register answer.
- The document rail and the Omega export panel read the stored verdict: a `mismatch` is a warning
  marker on the rail row and a pre-export warning listing affected documents. Export is not blocked.
- ADR 0018 says registers are used "at setup and for partner enrichment rather than per document" and
  VIES "once per setup, never per document". This PRD amends that: registers and VIES are consulted
  **once per subject**, cached in the directory, and refreshed by age — not per document. An ADR
  amendment records this.

### Subject directory (*Adresár subjektov*)

- A new **global** table of subjects, shared by all companies (unlike the existing per-company
  `partners` table, which remains the record of what the Omega export sent for each client). Key:
  `(country, IČO)`; subjects without an IČO (foreign suppliers) are keyed by normalised VAT ID. The
  Slovak/Czech separation of ADR 0018 is preserved by the country in the key.
- Each subject records: country; IČO; current legal name; former names from the register; names seen
  on documents (aliases) with counts; DIČ; IČ DPH; VAT-group id where known; address; register
  status (active, dissolved); VAT status from VIES; the source of each value (`register`, `vies`,
  `manual`); `verifiedAt`; `lastSeenAt`; and a manual-override marker per field.
- A **subject-directory service** (deep module) exposes, in essence: resolve a party to a subject
  (by IČO, then VAT ID, then exact alias), fetching from `CompanyRegister` and `VatRegister` when the
  subject is unknown or stale; record a sighting; apply a manual correction; search. Register calls
  are deduplicated per subject across replicas (one in-flight lookup per key, via the existing Redis
  infrastructure) and rate-limited, since RPO answers in seconds (ADR 0018 amendment).
- Staleness: register data older than a configurable age (default 30 days) is refreshed in the
  background on the next sighting. Manually corrected fields are never overwritten by a refresh; a
  disagreement between a manual value and a fresh register answer becomes a directory-level finding.
- Client companies are linked to their directory subject through their profile's IČO, so a client
  appearing as a counterparty on another client's document resolves to the same subject.
- The Omega export's partner enrichment reads the directory first and falls back to the registers
  only for unknown or stale subjects, then records the result in the directory.
- A new top-level screen, *Adresár*, lists subjects with search (name, alias, IČO, DIČ, IČ DPH),
  shows each subject's verdict, sources and referencing companies/documents, and allows correcting
  fields. It follows the Slovak workbench conventions of ADR 0015.
- Schema changes: the subjects table (and an alias child table or JSON column); the document payload
  gains per-party integrity verdicts and the two new provenances; settings gain the directory
  refresh age.

### Pre-created folders and the open month

- **Hugo creates no folders.** Remove automatic month-subfolder scaffolding from the sweep, the
  creation of month N+1 on close, and slot creation for late-arrival moves. The folder-create
  mutation stays in the codebase only if another caller remains; otherwise it is retired. This
  amends ADR 0005 ("Closing month N scaffolds the folders for month N+1") and ADR 0006 ("If the
  destination folder slot does not exist … it is created"); both amendments are written as part of
  this work.
- Folder **renames** for near-miss repairs (ADR 0007) are unchanged: still proposed, confirmed,
  recorded and undoable.
- **Open month** becomes: the newest month without `closedAt` whose key is not after the current
  calendar month (Europe/Bratislava). Month keys after the current month are **future months**: swept
  and stored, hidden from pickers and the open-month logic until their month starts. A pure
  month-lifecycle function takes the month list and "today" as input so the rule is testable.
- Documents found in a future month are surfaced on the current open month as an informational
  notice, not moved and not proposed for a move.
- Late-arrival move proposals whose destination slot is missing become a warning that names the
  missing folder, linking to the structure view.
- Company **display name**: a pure function strips a leading `Konto ` (case-insensitive, NFC) from the
  Drive folder name for display and for register search. The stored Drive name is unchanged.
- **Canonical folder names** default to `01 Vystavené faktúry`, `02 Prijaté faktúry`,
  `03 Bankové výpisy`, `04 Platby hotovosťou`, `05 Platby kartou`, `06 Iné doklady`, `07 Mzdy`; the
  movable default becomes `02`, `04 Platby hotovosťou`, `05 Platby kartou`, `06`. A data migration
  updates the stored lists **only where they still equal the old defaults**; customised lists are
  left alone. The existing settings impact preview (ADR 0007 amendment) is how anyone checks the
  effect. Code that identifies folders by their two-digit number (`02 …` is received invoices) keeps
  working; any code that names `Bločky` literally is updated.

### Structure conformance (*Štruktúra Drive*)

- A pure **drive-structure module** checks one company at a time. Input: the company folder, its
  direct children, each current-year month's direct children, the structure settings (company
  prefix, canonical subfolder list) and "today". Output: a list of deviations, each with a kind, a
  Drive path, a severity and, where applicable, a repair proposal reused from folder classification.
- Deviation kinds:
  - `company-prefix-missing` — company folder name does not start with `Konto `;
  - `year-missing` — the current year has no month folders at all (one deviation, not twelve);
  - `month-missing` — a current-year `YYYY_MM` folder is absent while others exist;
  - `month-duplicate` — two folders parse to the same month key;
  - `month-not-archived` — a `YYYY_MM` folder of a past year sits beside the current year;
  - `subfolder-missing` — a current-year month lacks a canonical subfolder;
  - `subfolder-repair` — a near-miss name, with the existing rename proposal;
  - `folder-unrecognised` — an unknown folder at company or month level;
  - `file-misplaced` — a file directly in the company folder or a year archive folder (month-root
    files remain the VAT outputs and are allowed).
- Past-year archive folders (`YYYY`) are accepted and not descended into.
- The sweep computes deviations from the tree it already builds and stores them per company,
  replaced wholesale on each sweep, so a fix in Drive clears the deviation on the next sweep. Nothing
  about deviations is a persistent to-do; ADR 0006's persistent log stays specific to late arrivals.
- The *Firmy* row shows a badge with the deviation count linking to a per-company structure view;
  the summary strip gains *odchýlky štruktúry*. The existing folder-repair panel in the month screen
  stays and links to the structure view.
- The company prefix and the expectation of twelve pre-created months are global settings, so the
  office can change its convention without a deploy, consistent with ADR 0006 and ADR 0007.

### Advance-settled invoices (ADR 0017 amendment)

- A pure **advance-settlement module** runs deterministically on the document's text lines and the
  extracted payload, after the model and before PRD 0003's enrichment and VAT derivation. Interface,
  in essence:
  - input: the reading-order text lines, the extracted total, the extracted VAT recap rows;
  - output: either "not settled" (payload unchanged) or a settlement — the supply total with its
    provenance (`extracted` when a grounded gross total was found, `derived` when summed from supply
    rows), the supply recap rows, the settlement rows removed from the recap, the advance deducted, the
    amount due, the referenced advance document numbers, and any findings.
- Detection requires **both** a deduction signal and evidence of a supply: a deduction label
  (`Zál. daň. dokl.`, `odpočet zálohy`, `uhradené zálohou`, `celkom uhradených záloh`, `zálohy celkom`,
  `preddavok`, compared folded for case and diacritics) **and** non-zero supply rows or a non-zero
  printed gross total. A zero total without any deduction label is not a settlement; it is flagged by
  the existing arithmetic check as before.
- Settlement rows are recap rows whose label carries a deduction marker, or negative rows that exactly
  cancel a supply row of the same rate. They are kept in the payload for audit, never used for VAT.
- The supply total prefers a printed gross total that is grounded in the text and equals the supply
  rows' base + VAT (within the existing cash-rounding tolerance); otherwise base + VAT of the supply
  rows with provenance `derived`.
- New payload fields: `advanceDeductedCents` / literal, `amountDueCents` / literal,
  `advanceDocumentNumbers`, and an `advanceSettlement` flag with its source (`detected`, `manual`).
  The accountant can set or clear the flag; a manual value wins (ADR 0010).
- Checks: base + VAT = supply total as before; *total − advance = due* as an additional, informational
  identity; a zero amount due is never an arithmetic mismatch on a settled invoice.
- PRD 0003's VAT summary derivation reads only supply rows; its single-rate VAT inference is skipped
  on settled invoices.
- The fields panel shows *Odpočet zálohy* and *K úhrade* under *Sumy* for settled invoices, the
  referenced advance documents, and the hint. The existing *proforma* hint is unchanged.
- The Omega export uses the supply values. How the deduction itself is reflected in Omega is the
  accountant's concern there; the advance amount and advance document numbers are available on the
  document but not exported as separate lines in this PRD.
- The extraction pipeline version is bumped so undecided documents in open months are re-read; decided,
  exported and closed-month documents are left alone (PRD 0003's protection rules).
- The model schema does not change, so the model benchmark is unaffected; the benchmark fixtures gain
  labels for the three settled invoices already in the corpus so deterministic scoring covers them.

### Compatibility

- Multi-user access needs no authentication change: the allowlist already accepts several emails
  (ADR 0011). ADR 0011's "exactly one user" context is updated by a short amendment.
- Existing documents without integrity verdicts are verified lazily the next time they are opened
  or extracted; no bulk backfill is required, though a one-off backfill job for open months is
  allowed.
- Existing `months` rows for future months created by older scaffolding stay; they simply become
  future months under the new rule.

## Testing Decisions

- **Every module this PRD builds or changes gets tests**, written test-first per slice:
  subject-integrity, subject-directory, party-swap, assigned-companies, drive-structure, the
  open-month rule in month lifecycle, the company display name, advance-settlement, and the changed
  sweep, close-month and late-arrival paths. The per-module expectations follow.
- Good tests assert externally observable behaviour: verdicts and findings for given identities,
  deviations for a given folder tree, the open month for a given month list and date, the filtered
  company list and summary, the swapped draft, persisted values and provenance, and what the screens
  show. They do not assert helper call order, React internals or private intermediate shapes.
- **subject-integrity**: exhaustive table-driven unit tests — valid and invalid IČO checksums (SK and
  CZ), DIČ/IČ DPH shapes, Slovak divisibility by 11, VAT-group notice, name equivalence across legal
  forms/diacritics/punctuation, former-name notice, wrong-company name, DIČ mismatch, VIES invalid,
  VIES other holder, group registration with and without directory membership, foreign subject,
  register unavailable, client party checked against profile.
- **subject-directory service**: integration tests against the existing store test database with
  fake `CompanyRegister` and `VatRegister` adapters — first resolution fetches and stores; second is
  served from the directory with no register call; stale refresh; manual correction survives refresh;
  SK/CZ IČO collision stays separate; alias recording; register failure leaves the directory
  unchanged and yields `unavailable`; export enrichment uses the directory.
- **party-swap**: unit tests for all eight fields and provenance, involution, empty sides, and
  interaction with draft rebasing.
- **assigned-companies**: unit tests for parse/serialise, corrupt and foreign values, per-user keys,
  add/remove, filtering, unknown ids, and summary recomputation over the visible rows.
- **drive-structure**: table-driven unit tests built from the `.agents/ctx/gdrive/structure` snapshot
  as the conforming baseline, then one mutation per deviation kind; year rollover; NFD folder names
  (ADR 0007 amendment); archive folders not descended.
- **month lifecycle**: unit tests for the open-month rule with pre-created future months, out-of-order
  closes, year boundaries and the time zone edge at midnight; sweep tests that no folder-create
  mutation is ever issued; close-month tests that closing creates nothing in Drive.
- **display name**: unit tests for the `Konto ` prefix strip, including case and NFD input.
- **advance-settlement**: table-driven unit tests over the three settled invoices in the private
  benchmark corpus (negative `Zál. daň. dokl.` rows at 0 % and 23 %; full recap with
  `Celkom uhradených záloh` and `Celkom k úhrade vrátane DPH 0,00`) plus synthetic cases: no deduction
  label (not settled), zero total without supply (not settled, flagged), partial advance (due > 0),
  several rates with one cancelled, printed gross total disagreeing with supply rows, cash rounding,
  credit notes (negative supply — not a settlement), Czech labels, and manual override in both
  directions. Integration tests confirm that PRD 0003's VAT summary and single-rate inference read the
  settled payload correctly and that the Omega export carries the supply values.
- **UI**: component tests for the swap button (enabled/disabled, provenance badges, warnings refresh),
  integrity badges and *Prevziať z registra*, and the *Moje firmy* toggle with a blocked
  `localStorage`.
- **End to end**: one Playwright flow — assign two companies, switch to *Moje firmy* and see the
  summary change; open a swapped invoice, swap it, take a register value for a flagged party; open the
  structure view for a company seeded with a missing subfolder and a prefix-less name.
- Prior art: the pure module suites for folder taxonomy, folder settings, month lifecycle, party roles,
  party enrichment, register search and chase list; the sweep and drive-mutation integration tests;
  the company-register adapter tests with fakes; `tests/ui/fields-panel.spec.ts`; and the
  company-profile and invoice-fields Playwright specs.
- Tests use hand-written fakes for Drive, registers and VIES — never the live services. The full unit
  suite, UI tests, the relevant Playwright specs, TypeScript compilation and async lint must pass.

## Out of Scope

- Server-side assignment of companies, roles, permissions or per-user visibility restrictions. Every
  allowlisted user can still open every company.
- Recording which user performed an action in the event and activity logs.
- Creating, moving or archiving Drive folders on the office's behalf, including a one-click "create
  missing folder" action and the year-end archive of `YYYY_MM` folders into `YYYY`.
- Reading or validating the contents of past-year archive folders.
- Using the subject directory to steer the extraction model (prompting with known subjects) or to
  infer roles; roles stay derived from the company profile.
- Registers beyond RPO, RÚZ, ARES and VIES (for example foreign business registers or the Slovak
  list of VAT payers to be deregistered).
- Bulk editing or merging of directory subjects.
- Syncing the directory with Omega's own partner list.
- Exporting the advance deduction of a settled invoice as separate lines or pairing it with the
  original advance tax document; Hugo exports the supply values and shows the references.
- Changing the model's output schema for advance invoices; detection is deterministic.

## Further Notes

- The structure snapshot shows `2024` and `2025` as empty folders. Whether real archive years hold
  month folders or flat files is not known from the snapshot; this PRD treats archive years as opaque.
  Confirm against the live shared drive before the structure check ships, and adjust if archives
  should be checked too.
- The canonical name change (`04 Bločky_hotovosť` → `04 Platby hotovosťou`, `05 Bločky_firemná karta`
  → `05 Platby kartou`) is far beyond the edit distance of ADR 0007's near-miss rule, so folders still
  using old names will be reported as unrecognised rather than offered a rename. If the live drive
  still has many old names, a one-time, explicitly confirmed bulk rename may be worth a follow-up
  slice.
- ADR amendments written with this PRD (2026-11-11): ADR 0005 (no scaffolding on close; future
  months), ADR 0006 (no slot creation; new movable defaults), ADR 0007 (office folder names; structure
  conformance; display name), ADR 0011 (several users; *Moje firmy* is a filter, not a permission),
  ADR 0017 (advance-settled invoices keep their real values), ADR 0018 (every party verified, once per
  subject). New: ADR 0022 (shared subject directory). Implementers amend these further if a slice
  proves a decision wrong, as earlier slices did.
- Accounting note on advance-settled invoices: the VAT of a final invoice after an advance tax
  document was already declared on that advance document. The office asked for the full supply values;
  how the advance is offset is done in Omega. Hugo keeps the advance amount and document numbers so
  nothing is lost.
- Suggested slicing, each independently shippable: (1) open-month rule and stop creating folders;
  (2) canonical names and `Konto ` display name; (3) structure conformance; (4) *Moje firmy*;
  (5) swap parties; (6) advance-settled invoices; (7) offline integrity checks; (8) subject directory
  with register-backed integrity; (9) directory screen and export integration.

### Decisions after implementation, 2026-11-12

- **Swap, settlement toggle and *Prevziať z registra* on decided documents:** allowed, like the field
  edits; refused only for exported documents and closed months (story 21 amended).
- **A party with only an IČO** (no DIČ, no IČ DPH to tell its country) is looked up in the Slovak
  register first, then the Czech one; the first that holds it names the subject. The directory fill
  for such a party prefers the Slovak subject the same way. An IČO failing its checksum is not looked up.
- **Late arrivals** are moved into the open month, which is the current calendar month whenever its
  folder exists and is not closed (issue 19, ADR 0005 and ADR 0006 amendments of 2026-11-12).
- **Archive years** stay opaque for now.
- **The live shared drive is the source of truth.** Its root holds one folder per accountant
  (`Eva – doklady klientov`, `Katarína – doklady klientov`, `Archív – doklady klientov`); their company
  folders are swept with the accountant as the company's group, and *Firmy* filters by group next to
  *Moje firmy*. `files.list` asks `corpora=allDrives`, without which a shared drive is not listed.
  Company folders are now named `Doklady <company>`; the display name strips it.
- **Older subfolder names are accepted** as their slots alongside the current ones (ADR 0007
  amendment of 2026-11-12), so months in the older scheme are complete and their documents processed.

- **The office's structure (2026-11-12):** disk → accountant → client → month → type, read by depth
  and folder ID; months by a `YYYY_MM` prefix; from 2027_01 the eight types by code, older months by
  name; cash and card receipts one type (`04 Bločky`). See the rewritten ADR 0007 amendment.
