# 04 — Sheet clients without a Doklady folder go into the Adresár

Type: AFK
Status: open

## What to build

The office's answer to 0005/11: the Adresár is the table of every client and partner the office has
seen. So a sheet row with an IČO goes into the Adresár even without a company in Hugo, that is, without
a Doklady folder. On the 2026-11-16 sheet, that is 49 active clients of Katarína, plus former clients
in Archív that have an IČO.

- The import preview lists these rows as **into the Adresár**, not as unmatched. On confirm, each
  creates or updates a subject by `(country, IČO)`, with the sheet's values (source `sheet`).
- A subject records that it is an **office client**, with the accountant (*Vedie*) and the cooperation
  state (*Spolupráca*: aktívna / ukončená) from the sheet. The Adresár's client filter shows these with
  the linked client companies. Such a subject has no months and no folder.
- Rows without an IČO are still only reported.
- The office-client subjects are queued for the register check (slice 03) like any client.

## Acceptance criteria

- [ ] Unmatched rows with an IČO show as "into the Adresár" in the preview, and create or update subjects on confirm.
- [ ] A subject carries office-client status, accountant and cooperation state (schema and migration). The Adresár shows them and its client filter includes them.
- [ ] Re-importing the same sheet changes nothing. Rows that later get a company link to it by IČO (slice 01's rule).
- [ ] Unit and integration tests with made-up companies. A UI test for the preview section and the client filter.

## Blocked by

- 02 — The client sheet import fills the Adresár
