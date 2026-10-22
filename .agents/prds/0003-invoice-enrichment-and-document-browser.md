# PRD 0003 — Invoice enrichment and document browser

Status: ready-for-agent
Primary user: single accountant (sole user of the system)
Continues: PRD 0002 (`.agents/prds/0002-document-extraction-and-omega-export.md`)

> This PRD improves the review step after extraction. It deterministically completes safe company
> and VAT data, makes the document rail searchable and sortable, and changes an explicitly requested
> re-extraction into an atomic replacement of the document's accounting fields.

---

## Problem Statement

The document workbench extracts enough invoice data to begin review, but it leaves avoidable gaps
and makes a larger month unnecessarily slow to navigate.

On Slovak invoices, an extracted party can have an IČ DPH but no DIČ even though the DIČ is the ten
digits after the `SK` prefix. The app uses the company profile to identify the accountant's client,
but does not use that profile to complete missing identity fields on the client side of an invoice.

Invoice VAT information is split across two presentations. The extraction can contain rows under
*DPH podľa sadzby*, while the aggregate *Základ DPH (SPOLU)* and *DPH (SPOLU)* fields under *Sumy*
remain empty. Some single-rate invoices expose only a VAT base and a VAT-inclusive total; the app
does not derive the VAT amount or rate even when the arithmetic identifies one permitted rate
unambiguously. As a result, the accountant repeats safe arithmetic and fills values the system
already has enough information to know.

The document rail is also constrained to roughly 248–264 pixels and keeps Drive discovery order.
It cannot be searched or sorted. Although it shows a formatted amount, issue date is buried in the
secondary folder line and the narrow layout does not expose price and date as useful columns. The
accountant cannot quickly find an invoice by partner, filename, number, variable symbol, or tax
identifier, nor can she order work by date, amount, name, filename, or processing state.

Finally, the current manual re-extraction contract conflicts with the desired recovery workflow.
When the accountant explicitly chooses *Načítať znova*, she expects a successful fresh read to
replace every old accounting field, including previous manual corrections and calculated values.
That replacement must not destroy usable data if the fresh extraction fails.

## Solution

Add deterministic enrichment between extraction and review, backed by explicit provenance and
strict non-overwrite rules during ordinary editing:

- Derive a missing Slovak DIČ from a valid `SK` IČ DPH for either invoice party.
- Use invoice-folder direction to identify the client side and fill its missing name, IČO, DIČ,
  and IČ DPH from the company profile. Preserve conflicting values and flag the party for review.
- Derive invoice aggregate VAT base and VAT totals from valid per-rate rows when those aggregate
  fields are empty.
- For a single-rate invoice with a VAT-inclusive total and VAT base, derive VAT as their signed
  difference and fill one VAT row only when the result matches a permitted country rate within one
  cent. Never invent a rate when the arithmetic is ambiguous or invalid.
- Use persisted `derived` provenance for calculated values so they can be recalculated safely,
  exported, distinguished from manual input, and shown as *vypočítané*.

Turn the left rail into a real document browser. Widen it, show price and issue date as dedicated
columns, add normalized live search, add five stable sort modes and direction control, and make
selection, keyboard navigation, and auto-advance follow the visible sorted results. Keep VAT output
files in their own read-only section.

Change explicit manual re-extraction into an atomic replace operation. Old accounting data stays
visible while the job runs and remains intact after failure. Only a successful fresh extraction
replaces the extracted payload, manually confirmed fields, calculated values, and their provenance.
Notes, file/document identity, and append-only audit history remain. Confirmed, exported, or closed
documents retain their existing protection against re-extraction.

This PRD supersedes PRD 0002's statement that corrections survive every re-extraction only for an
explicit user-triggered *Načítať znova*. It does not authorize background extraction to overwrite
manual work.

## User Stories

1. As the accountant, I want a missing DIČ derived from a valid Slovak IČ DPH, so that I do not copy the same ten digits by hand.
2. As the accountant, I want DIČ derivation to work for suppliers and customers, so that invoice direction does not create inconsistent behavior.
3. As the accountant, I want an existing DIČ preserved, so that deterministic enrichment never overwrites extracted or manual data during normal review.
4. As the accountant, I want malformed and non-Slovak VAT identifiers ignored by the DIČ rule, so that the app does not manufacture tax identifiers.
5. As the accountant, I want my company recognized as the supplier in issued invoices, so that its profile fills the correct side.
6. As the accountant, I want my company recognized as the customer in received invoices, so that its profile fills the correct side.
7. As the accountant, I want an entirely missing client party completed from the profile according to the invoice folder, so that weak extraction does not force full manual entry.
8. As the accountant, I want only missing client name, IČO, DIČ, and IČ DPH values filled from the profile, so that printed data remains authoritative.
9. As the accountant, I want profile conflicts preserved and flagged, so that a misfiled invoice remains visible instead of being silently corrected.
10. As the accountant, I want counterparty data left independent of my company profile, so that enrichment cannot copy my identity onto the other party.
11. As the accountant, I want addresses excluded from this enrichment, so that the review form and export are not expanded with unused data.
12. As the accountant, I want *Základ DPH (SPOLU)* to equal the sum of valid VAT-row bases when the aggregate is missing, so that the Sumy section is complete.
13. As the accountant, I want *DPH (SPOLU)* to equal the sum of valid VAT-row VAT amounts when the aggregate is missing, so that the Sumy section is complete.
14. As the accountant, I want all rates, including zero-rated rows, included in aggregate totals, so that multi-rate invoices reconcile.
15. As the accountant, I want a manually entered aggregate VAT value to take precedence, so that my correction is never replaced by a calculation.
16. As the accountant, I want VAT derived from `Celkom − Základ DPH` on a single-rate invoice, so that I do not perform routine subtraction.
17. As the accountant, I want a permitted VAT rate inferred from base and VAT-inclusive price when the arithmetic is exact within one cent, so that a missing printed rate can be completed safely.
18. As the accountant, I want Slovak invoices limited to 23%, 19%, 5%, or 0%, so that an arithmetically plausible but invalid Slovak rate is not accepted.
19. As the accountant, I want Czech invoices limited to 21%, 12%, or 0%, so that Czech VAT is validated with Czech rules.
20. As the accountant, I want the supplier's IČ DPH prefix to decide the valid rate set on a received invoice, so that the client company's country does not misclassify the issuer.
21. As the accountant, I want the company profile country used as a flagged fallback when supplier country is unknown, so that the app can still help without presenting uncertainty as fact.
22. As the accountant, I want negative credit-note totals and bases handled with signed arithmetic, so that correct credit notes derive the same way as invoices.
23. As the accountant, I want an unmatched or ambiguous calculated rate left empty with a warning, so that the app never invents a percentage.
24. As the accountant, I want VAT calculations to react while I edit the total or base, so that the form completes safe dependent values immediately.
25. As the accountant, I want manually entered VAT and rates protected from recalculation, so that deliberate bookkeeping choices remain mine.
26. As the accountant, I want stale calculated values recomputed when their dependencies change, so that derived data cannot silently drift out of date.
27. As the accountant, I want calculated fields labelled *vypočítané*, so that I can distinguish system arithmetic from printed or manually entered values.
28. As the accountant, I want calculated values retained after reload and included in export, so that derivation is not merely cosmetic UI state.
29. As the accountant, I want to type in a search field and immediately narrow the current folder's documents, so that I can find a document without scanning the rail.
30. As the accountant, I want search to ignore case and Slovak/Czech diacritics, so that typing speed and keyboard layout do not prevent a match.
31. As the accountant, I want search to cover displayed party name, original filename, document number, variable symbol, and both parties' IČO, DIČ, and IČ DPH, so that I can use whichever identifier I have.
32. As the accountant, I want search combined with the active folder filter, so that it does not unexpectedly reveal documents from other accounting folders.
33. As the accountant, I want `/` to focus search and `Escape` to clear it, so that search is fast without breaking the existing `C`, `N`, `J`, and `K` review shortcuts.
34. As the accountant, I want the visible-result count shown against the total count, so that I know when a filter is active.
35. As the accountant, I want to sort documents by issue date, price, partner name, filename, or processing state, so that the rail fits the task I am doing.
36. As the accountant, I want every sort reversible, so that I can inspect either end of the ordered set.
37. As the accountant, I want issue date descending as the default, so that recent invoices appear first.
38. As the accountant, I want sort and direction stored in the URL, so that refreshes and shared links retain the ordering.
39. As the accountant, I want missing sort values always last, so that incomplete documents do not jump unpredictably between ends of the list.
40. As the accountant, I want names sorted with Slovak locale rules, so that alphabetical order matches what I expect.
41. As the accountant, I want price sorted numerically within currency, so that formatted strings do not produce incorrect ordering.
42. As the accountant, I want price sorting grouped by currency with home currency first and no invented conversion, so that unlike currencies are not compared as if equivalent.
43. As the accountant, I want state sorting to put documents needing manual work or review first, so that the most actionable documents are easy to reach.
44. As the accountant, I want stable date and name tie-breakers, so that repeated sorting does not reshuffle equivalent documents.
45. As the accountant, I want the current document retained when it remains visible after search or sorting, so that changing browser controls does not interrupt review.
46. As the accountant, I want the first visible result selected when the current document disappears, so that preview and fields never point outside the visible list.
47. As the accountant, I want `J`/`K` and automatic advance to follow visible sorted results, so that keyboard review matches what I see.
48. As the accountant, I want the rail wide enough for identity, price, and issue date, so that useful metadata does not make partner names unreadable.
49. As the accountant, I want dedicated `Cena` and `Vystavené` columns, so that values line up and can be scanned vertically.
50. As the accountant, I want issue date shown as `DD.MM.YYYY` and `—` when absent, so that rows remain consistent and honest.
51. As the accountant, I want the old duplicate date removed from the folder-detail line, so that each row presents the date once.
52. As the accountant, I want VAT output files kept in their own read-only section, so that they are not confused with accounting documents.
53. As the accountant, I want search to match VAT output filenames, so that month outputs remain findable.
54. As the accountant, I want VAT output files alphabetized independently of document sorting, so that missing document metadata does not distort their section.
55. As the accountant, I want a successful manual re-extraction to replace all prior accounting fields, so that *Načítať znova* gives me a genuinely fresh result.
56. As the accountant, I want manual and calculated values cleared only after a successful replacement, so that the new payload cannot be shadowed by stale confirmed data.
57. As the accountant, I want old data to stay visible while re-extraction runs, so that background work does not blank the form.
58. As the accountant, I want failed re-extraction to preserve every prior field and show the failure, so that retrying cannot destroy usable work.
59. As the accountant, I want notes preserved across re-extraction, so that workflow context is not treated as extracted accounting data.
60. As the accountant, I want file identity, document identity, and audit history preserved, so that replacement remains traceable.
61. As the accountant, I want confirmed, exported, and closed documents protected from re-extraction, so that accepted or delivered books cannot change underneath me.
62. As the accountant, I want a re-extraction request and its success or failure recorded, so that the audit log explains why document data changed or did not change.

## Implementation Decisions

### Party enrichment

- Introduce or extend a pure party-enrichment module. Its input is extracted/confirmed parties,
  invoice folder direction, and the optional company profile; its output is supplier/customer
  identities, per-field provenance, and conflict flags.
- A missing DIČ may be derived only from a normalized Slovak IČ DPH matching `SK` followed by ten
  digits. Strip exactly the `SK` prefix. Apply the rule to either party and never overwrite a
  present value.
- For `01 Vystavené faktúry`, the expected client party is the supplier. For `02 Prijaté faktúry`,
  it is the customer. Fill missing legal name, IČO, DIČ, and IČ DPH from the profile, including when
  extraction omitted the expected party entirely.
- Confirmed and extracted non-empty fields remain authoritative during ordinary display/edit merge.
  A value contradicting the profile is preserved and produces the existing role/conflict warning.
- Profile address is not projected into document fields.

### VAT derivation

- Build a pure VAT-derivation module shared by server-side field merging, the client editor, checks,
  and export-facing values. The interface accepts totals, VAT rows, country evidence, and field
  provenance and returns enriched values, provenance, and warnings.
- If aggregate base or aggregate VAT is empty and at least one valid VAT row exists, derive the
  missing aggregate as the signed sum across every row. A confirmed aggregate remains authoritative.
- Single-rate inference runs only when there is no populated VAT recap and both VAT-inclusive total
  and aggregate base parse successfully. VAT is `total − base` in minor units.
- Match the derived VAT against permitted rates using minor-unit arithmetic with at most one cent
  tolerance. Slovak rates are 23, 19, 5, and 0; Czech rates are 21, 12, and 0.
- On received invoices, infer issuer country first from the supplier IČ DPH prefix. If unavailable,
  use the company profile country but mark the inferred row for review. Issued invoices use the
  client/company country. An unsupported or ambiguous country/rate produces no inferred percentage.
- Signed amounts support credit notes. Zero base with a non-zero total cannot infer a rate. A zero
  base and zero total may represent 0% only when the remaining document data supports a populated
  VAT row; it must not create a meaningless row from an entirely empty document.
- A derived VAT amount or row never overwrites a manual/extracted populated value. Conflicts remain
  visible through arithmetic warnings.
- Add persisted `derived` provenance with enough dependency metadata to distinguish calculated from
  manual/printed values and safely recalculate only calculated values after dependency changes.
  The UI renders such values with a compact *vypočítané* indicator.
- Apply automatic extraction enrichment only to results produced by the new pipeline contract.
  Existing completed documents are neither rewritten nor newly enriched merely because this PRD
  ships. A user can opt into the new result through explicit re-extraction; live VAT derivation may
  also run after the user deliberately edits one of its dependency fields.

### Document browser

- Create a framework-independent browser-projection module. It prepares normalized search text and
  comparison keys, filters documents, and performs stable sorting without React or URL concerns.
- Search is immediate substring matching after lowercasing, Unicode diacritic removal, and benign
  whitespace normalization. Index displayed partner label, original filename, document number,
  variable symbol, and supplier/customer IČO, DIČ, and IČ DPH.
- Search applies after the server-provided folder filter. It is local UI state, not a URL parameter.
  `/` focuses the search input. `Escape` clears it and returns focus to the browser. Existing review
  shortcuts remain active outside typing controls.
- Supported sort keys are issue date, price, partner name, filename, and processing state. Every key
  supports ascending and descending direction. The URL carries sort and direction alongside folder;
  links that change folder preserve sort and direction. Search is intentionally cleared on navigation.
- Default order is issue date descending. Missing values are last in both directions. Stable
  tie-breakers are issue date descending, locale-aware partner name, filename, then document ID.
- Partner and filename comparisons use Slovak locale collation. Price uses integer minor units,
  groups by currency with company home currency first, sorts currencies deterministically, then
  sorts numerically. There is no exchange-rate lookup or conversion.
- Processing-state ascending/action-first rank is: manual entry or warnings; awaiting decision;
  extraction pending; confirmed; not relevant. Descending reverses the primary rank. Ties use the
  stable date/name rules.
- Keep selection when its document remains visible. Otherwise select the first visible document.
  `J`/`K` navigation and post-decision auto-advance use the visible sorted array and never escape an
  active search or folder filter.
- Widen the document rail to approximately 360 px at normal desktop width and 400 px at wide desktop
  width, while leaving the preview column flexible. Rows use status, identity, price, and issue-date
  columns with compact `Cena` and `Vystavené` headers. Issue date is `DD.MM.YYYY`, or `—` when absent,
  and is removed from the folder-detail line.
- Place a compact toolbar below folder chips: full-width search with clear action, sort selector,
  direction toggle, and visible/total count. Stack controls on narrower layouts instead of hiding them.
- Read-only VAT output files remain in *Výstupy DPH — len na čítanie*. Search filters that section by
  filename. The section remains separate and alphabetic; document sort modes do not mix or reorder it.

### Atomic manual re-extraction

- Manual *Načítať znova* remains available only for an open month when no document from the source
  file is decided or exported.
- A re-extraction request marks a replacement attempt as pending without erasing the active extracted
  or confirmed payload. The view continues to render the active data during processing.
- Stage the fresh result separately from active data. On successful extraction, atomically promote
  the new extracted payload and clear all confirmed accounting fields, calculated values, and derived
  provenance for every affected document from that source file.
- A sparse but structurally valid successful extraction is still authoritative: explicit manual
  re-extraction means fresh data replaces old data rather than merging with it.
- On extraction failure or infrastructure interruption, discard the staged result, keep active data
  unchanged, and expose the failure reason. A later retry begins from the same preserved data.
- Preserve document/file identity, note, decision/export protection, and append-only audit history.
  The typed eKasa UID is accounting/extraction input and is cleared on successful replacement unless
  the fresh payload itself contains it.
- Record request, completion, and failure events with company, month, file, document, source, and
  outcome sufficient to audit the replacement.
- This rule applies only to explicit user-triggered re-extraction. Background refresh and pipeline
  upgrades do not gain permission to erase confirmed values.

### Compatibility and data shape

- Extend payload/provenance parsing compatibly so documents written before this PRD still parse.
  Absence of derived metadata means existing values are treated as non-derived and protected.
- Prefer JSON payload evolution over new relational columns for field-level derived metadata unless
  transactional staging requires a dedicated document-attempt record. If staging needs schema, keep
  its lifecycle internal to extraction and expose only the atomic active-result contract.
- The Omega export consumes the same effective enriched field projection shown to the accountant.
  It must not independently reimplement VAT or party derivation.
- Advance the extraction pipeline version for newly produced results and use that version to gate
  automatic enrichment. The existing scheduler never retries completed documents solely because a
  version changed, so this does not bulk-rewrite old data. A fresh read happens only through the
  existing explicit re-extraction action or other already-authorized extraction paths.

## Testing Decisions

- Good tests assert externally observable behavior: effective fields, provenance, warnings, visible
  ordering, persisted payloads, export inputs, and replacement outcomes. They must not assert helper
  call order, React implementation details, or private intermediate representations.
- Add exhaustive table-driven unit tests for party enrichment: valid/invalid Slovak VAT identifiers,
  both parties, present DIČ, issued/received direction, entirely absent client party, partial profile
  backfill, conflicts, no profile, and confirmed-value precedence.
- Add exhaustive table-driven unit tests for VAT derivation: one and multiple rows, zero-rated rows,
  aggregate precedence, Slovak and Czech rates, issuer-country selection and fallback warning, every
  one-cent tolerance boundary, invalid/ambiguous rates, zero base, decimal parsing, negative credit
  notes, recalculation of derived values, and protection of manual values.
- Add pure unit tests for document-browser projection: every indexed search field, case/diacritic
  normalization, search plus folder scope, all five sort keys in both directions, missing values last,
  Slovak collation, stable tie-breakers, mixed currencies, status rank, and VAT-output filename search.
- Add integration tests for manual re-extraction using the existing document-store test database:
  request retains old active values; success promotes fresh extraction and clears manual/derived
  fields; failure retains every prior field; notes and audit history survive; decided/exported/closed
  documents remain protected; multi-document source files replace atomically as one unit.
- Add UI/component tests for live VAT derivation, *vypočítané* badges, manual override protection,
  arithmetic warnings, toolbar controls, visible/total count, price/date columns, selection retention,
  first-result fallback, `/` and `Escape`, `J`/`K`, and auto-advance through visible results.
- Add one Playwright end-to-end workflow: open an invoice month, observe profile backfill and VAT
  completion, find and sort the invoice in the wider rail, edit a dependency and observe safe
  recalculation, request re-extraction, and verify successful replacement clears the earlier manual
  field while the note remains.
- Prior art is the existing pure module suites for document fields, party roles, extraction checks,
  model-output normalization, money, and draft rebasing; document/re-extraction integration tests;
  fields-panel UI tests; and invoice-fields/model-extraction Playwright tests.
- The full unit suite, UI test target, relevant Playwright spec, TypeScript compilation, and async lint
  must pass. Tests involving extraction use hand-written fakes and local fixtures, never a live model,
  OCR service, Drive, company register, or exchange-rate service.

## Out of Scope

- Adding supplier or customer address fields to document review or Omega export.
- Guessing DIČ from anything other than a valid Slovak `SK` IČ DPH.
- Supporting additional countries or VAT-rate calendars beyond the agreed current Slovak and Czech
  rate sets.
- Inferring multiple VAT rates from aggregate base and VAT-inclusive total; that problem is
  underdetermined and remains manual/extraction work.
- Exchange-rate lookup, currency conversion, or cross-currency numeric comparison.
- Searching document OCR/full text or Drive contents beyond indexed document metadata.
- Server-side/global search across companies or months.
- Mixing VAT output files into the accounting-document result set.
- Re-extracting confirmed, exported, or closed documents.
- Automatically rewriting existing stored documents or bulk-triggering re-extraction on deployment.
- Changing extraction models, OCR quality, extraction prompt/schema, or benchmark selection except
  where required to carry the agreed provenance and atomic replacement contract.
- Changing Omega accounting codes, posting rules, VAT sections, or unrelated export behavior.

## Further Notes

- Slovak terminology in the UI remains authoritative: *Doklady*, *Sumy*, *Základ DPH (SPOLU)*,
  *DPH (SPOLU)*, *DPH podľa sadzby*, *Cena*, *Vystavené*, and *vypočítané*.
- The one-cent rate tolerance is an acceptance tolerance in integer minor units, not floating-point
  percentage rounding. Implementations should compare candidate-rate VAT amounts in cents.
- Folder direction is a bookkeeping assertion used for profile backfill. A conflicting printed party
  is deliberately preserved and flagged because it can reveal a misfiled document.
- Search and sort are browser-local projections over the already loaded month/folder view. This keeps
  typing immediate and avoids new query endpoints at current data volumes.
- The widened rail must leave the center preview usable at supported desktop breakpoints. On the
  existing single-column responsive layout, controls and row metadata may stack while preserving all
  information and actions.
- Existing unrelated benchmark/parser changes in the working tree are not part of this PRD.
