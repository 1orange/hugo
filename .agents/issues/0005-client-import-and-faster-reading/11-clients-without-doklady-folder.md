# 11 — Clients without a Doklady folder

Type: HITL — needs the office's answer before it is built
Status: open

## What to build

Of the 139 rows in the 2026-11-16 sheet, 99 have no *ID priečinka Doklady* and no company in Hugo:

- 49 active clients of Katarína;
- 50 former clients in Archív.

Hugo knows a company only through its Drive folder, so these are invisible to it.

**Question for the office:** what are these 49 active clients?

- **(a)** Their documents arrive another way, and Hugo should only list them: in *Adresár*, or on
  *Firmy* as "bez priečinka Doklady".
- **(b)** Their folder exists but its id is missing from the sheet, so the sheet needs fixing.
- **(c)** Hugo should ignore them.

Recommended until answered: **(c)**, with the import preview (09) counting them as unmatched. Once
answered, build:

- **(a):** a company without a folder, shown and filtered on *Firmy*. It gets no months, and the import
  fills its profile.
- **(b):** the preview proposes a folder by name for each row.

## Acceptance criteria

- [ ] The office's answer is recorded in the PRD or an ADR.
- [ ] The chosen behaviour is built with its tests, or the slice is closed as (c).

## Blocked by

- 09 — Fill company profiles from the office's client sheet
