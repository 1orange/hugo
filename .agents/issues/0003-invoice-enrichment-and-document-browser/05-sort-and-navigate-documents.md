# 05 — Add stable document sorting and visible-result navigation

Type: AFK
Status: ready-for-agent
User stories: 35–47

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

Extend the searchable document rail with stable sorting by issue date, price, partner name, original
filename, or processing state. Every sort supports both directions; issue date descending is the
default. Persist sort key and direction in the URL alongside folder and preserve them when changing
folder chips. Search stays local and clears on navigation.

Missing values must remain last in either direction. Use Slovak locale collation for names and
filenames. Sort prices by integer minor units within currency groups, with company home currency
first and no conversion. The action-first processing-state order is: manual entry or warnings,
awaiting decision, extraction pending, confirmed, not relevant; reverse the primary rank for the
opposite direction. Apply deterministic date, name, filename, and document-ID tie-breakers.

Make the resulting visible sorted list the workbench navigation source. Preserve the current
selection when possible, otherwise choose its first item. `J`/`K` and post-decision auto-advance
move through visible sorted documents and never jump outside an active search or folder filter.

## Acceptance criteria

- [ ] The toolbar offers issue date, price, partner name, filename, and processing-state sorts plus an ascending/descending control.
- [ ] Issue date descending is the default, and sort key/direction round-trip through valid URL parameters.
- [ ] Folder links preserve sort key and direction while local search intentionally clears on navigation.
- [ ] Missing values sort last in both directions and all ties resolve deterministically.
- [ ] Partner and filename sorting use Slovak locale collation.
- [ ] Price sorting uses integer minor units, groups by currency with home currency first, and performs no exchange-rate conversion.
- [ ] Processing-state ascending follows the agreed action-first rank and descending reverses its primary order.
- [ ] The current selection survives reordering when visible; otherwise the first visible sorted result becomes selected.
- [ ] `J`/`K` and automatic advance follow visible sorted results and never leave active search/folder scope.
- [ ] Read-only VAT output files stay separate and alphabetic regardless of document sort.
- [ ] Pure tests cover every sort in both directions, missing values, collation, currencies, status rank, stable tie-breakers, and invalid URL fallbacks.
- [ ] UI/end-to-end tests cover URL persistence, folder changes, selection retention, keyboard traversal, and post-decision auto-advance.

## Blocked by

- 04 — Add searchable document rail with price and issue date (`04-searchable-document-rail.md`)
