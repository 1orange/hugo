# 04 — Add searchable document rail with price and issue date

Type: AFK
Status: ready-for-agent
User stories: 29–34, 48–54

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

Turn the left workbench rail into a wider, searchable document browser. Use approximately 360 px on
standard desktop and 400 px on wide desktop while keeping the preview flexible. Give rows aligned
status, identity, *Cena*, and *Vystavené* columns. Show issue date once as `DD.MM.YYYY`, or `—` when
missing, and remove the old date from the folder-detail line.

Add immediate local substring search over the active folder's displayed partner, original filename,
document number, variable symbol, and both parties' IČO, DIČ, and IČ DPH. Normalize case, diacritics,
and benign whitespace. Put the input and clear action below folder chips, show visible/total count,
focus search with `/`, and clear it with `Escape` without breaking existing review shortcuts. Keep
the currently selected document when visible and select the first visible result when it is filtered
out so preview and fields always correspond to the list.

Keep *Výstupy DPH — len na čítanie* separate. Search those files by filename and list them
alphabetically; do not mix them into accounting-document rows. Stack controls and metadata on narrow
layouts rather than hiding information.

## Acceptance criteria

- [ ] The desktop rail is approximately 360 px and the wide-desktop rail approximately 400 px while the preview remains flexible and usable.
- [ ] Document rows have aligned status, identity, price, and issue-date columns with `Cena` and `Vystavené` headers.
- [ ] Issue date renders as `DD.MM.YYYY` or `—` and is no longer duplicated in the folder-detail line.
- [ ] Search matches displayed partner, filename, document number, variable symbol, and supplier/customer IČO, DIČ, and IČ DPH.
- [ ] Search is case-insensitive, diacritic-insensitive, immediate, and constrained to the active folder filter.
- [ ] The toolbar provides a clear action and visible/total result count and remains usable on narrower layouts.
- [ ] `/` focuses search; `Escape` clears it and restores browser focus; `C`, `N`, `J`, and `K` are not intercepted while typing.
- [ ] Selection remains on a visible selected document or moves to the first visible result when filtering hides it; empty results show an appropriate state.
- [ ] VAT output files remain in their own read-only section, are filtered only by filename, and stay alphabetically ordered.
- [ ] Pure search-projection tests cover every indexed field, normalization, folder scope, empty results, selection coherence, and VAT-output search.
- [ ] UI tests cover dimensions/classes at breakpoints, row columns, keyboard behavior, counts, clear behavior, selection, and the separate VAT-output section.

## Blocked by

None - can start immediately
