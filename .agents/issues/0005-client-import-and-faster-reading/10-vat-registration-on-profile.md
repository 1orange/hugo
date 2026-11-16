# 10 — VAT registration, VAT period and status on the company profile

Type: AFK
Status: open

## What to build

The client sheet carries what the profile does not:

- the legal form;
- the kind of VAT registration: §4 payer, §7a (registered only for EU acquisitions and services), or
  neplatiteľ;
- the date she became a payer;
- the VAT period (mesačne / štvrťročne);
- the register status (aktívny, pozastavený do …, zaniknutý …).

Add these to the client's subject in the Adresár. Since 0006/01, that subject is the company profile. Fill them from the sheet import (09), and from the RPO/VIES lookup
where the register gives them. Show them:

- on the profile screen, editable;
- on *Firmy*, as quiet marks beside the company name: "štvrťročne" for a quarterly filer, "§7a" or
  "neplatiteľ", and a warning dot for a client the register lists as zaniknutý or pozastavený.

## Acceptance criteria

- [ ] The subject schema, migration and profile form carry legal form, VAT registration (§4 / §7a / neplatiteľ / unknown), payer since, VAT period and register status. Existing profiles read as unknown.
- [ ] The sheet import fills them, and the preview lists their changes like any other field.
- [ ] *Firmy* shows the marks, and the warning dot for a zaniknutý or pozastavený client.
- [ ] Unit tests for parsing the sheet's values ("§7a", "31.3.2023", "pozastavený do 31.01.2027", "zaniknutý 01.05.2026"). A UI test covers the marks.

## Blocked by

- 09 — Fill company profiles from the office's client sheet

## Note, 2026-11-16

These fields go on the subject, after 0006/01 (the client's profile is its Adresár subject). Blocked by 0006/01 as well.
