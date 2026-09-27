# 03 — The UID box on the fields panel

Type: AFK
Status: ready-for-agent
User stories: 4, 5

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The last step of ADR 0016's UID search, and the one that needs no machine at all. For a receipt the
app could not resolve — `IMG_3440`, whose QR the thermal printer damaged but whose UID is printed
legibly above it — she types or pastes the 34-character UID into a box on the fields panel, and the
lookup fills the whole document.

End to end: the box appears on any document in an editable month that has no lookup data yet; the
input is checked against the UID pattern with a Slovak message; a valid UID goes to the lookup from
slice 01; the result becomes the **extracted** payload with `source: "lookup"`, not her confirmed
one, because it is machine-read data she still reviews. A UID the lookup does not know changes
nothing and says so: a typo cannot attach another receipt's data. The typed UID is kept with the
document.

## Acceptance criteria

- [ ] The UID box appears on documents without lookup data, in editable months only
- [ ] An input that does not match the UID pattern is refused with a Slovak message before any request
- [ ] A valid UID fills the extracted payload with `source: "lookup"`; her confirmed payload is untouched and she still confirms the document
- [ ] A UID the lookup does not know leaves the document unchanged and reports "not found"
- [ ] The typed UID is stored with the document and an event is recorded
- [ ] A closed month does not offer the box
- [ ] E2E: type a UID into the box on a blank receipt, with the fake lookup, and see the fields fill and persist across a reload

## Blocked by

- 01 — Text-layer eBločky read through the OPD lookup
