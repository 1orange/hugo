# 02 — The client sheet import fills the Adresár

Type: AFK
Status: done

## What to build

The client sheet import (0005/09) writes each matched row to the company's subject in the Adresár. That
subject is now its profile (slice 01). Values from the sheet have source `sheet`: neither a register's
value nor her hand edit. The register check in slice 03 can then confirm them as *overené*.

The rest of the import behaves as before:

- preview first, nothing written until she confirms;
- matching by folder id, then IČO, then name, where a name match is a guess she confirms;
- empty fields are filled without asking; a field that already holds a different value is written
  only when ticked;
- one `ImportedFromClientSheet` event per company.

## Acceptance criteria

- [ ] A confirmed import creates or updates the client's subject, linked to the company, with source `sheet` on the fields it wrote.
- [ ] A field marked `manual` is changed only when ticked, and the tick replaces it with the sheet's value and source.
- [ ] The existing import tests pass against subjects. The integration test checks the Adresár entry after an import.

## Blocked by

- 01 — A client company's profile is its Adresár subject
