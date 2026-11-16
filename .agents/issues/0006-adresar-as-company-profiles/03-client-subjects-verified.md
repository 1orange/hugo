# 03 — Client subjects are checked against the registers, and each field shows its state

Type: AFK
Status: done

## What to build

**Register check.** After an import, a profile save, or the subject going stale (the existing 30-day
refresh), the client's subject is queued for the register check (RPO, then RÚZ/ORSR for SK; ARES for CZ)
and VIES for its IČ DPH. It uses the same subject worker, the same rate limit and the same one lookup
per key that counterparties use. Client subjects created from a profile are no longer exempt.

**Field states.** Each identity field (legal name, address, IČO, DIČ, IČ DPH) shows one of three states:

- **overené** (verified): the value is what the register or VIES said on its last answer. A value from
  the sheet or a lookup that the register confirms becomes *overené*.
- **upravené ručne** (edited by hand): she typed a value, and it differs from the register's last answer
  or has not been confirmed by it. The register's value is shown beside it. She can return to the
  register's value in one click, which makes the field *overené* again.
- **neoverené** (unverified): no register answer yet, the register was unavailable, or the subject is not
  in it.

These states replace the plain source label. They show wherever a subject's identity is shown: the
Adresár list (a summary per subject), the Adresár entry, and the company's profile page. The register
status (aktívny / pozastavený / zaniknutý) and the VIES status show next to them. A dissolved or
suspended client is marked on *Firmy* too.

## Acceptance criteria

- [ ] An import or a profile save queues the client's subject for the register and VIES checks. A register outage leaves the fields *neoverené* and is retried as for counterparties.
- [ ] A pure function gives each field's state from its value, source and the last register answer. Table-driven unit tests cover matching, differing manual values, a manual value equal to the register's, no answer, and an outage.
- [ ] "Return to the register's value" sets the field back to the register's value, removes it from the manual list, and makes it *overené*.
- [ ] The Adresár list, the entry and the profile page show the states. *Firmy* marks a dissolved or suspended client. UI tests cover the three states and the one-click return.
- [ ] Integration test (PGlite, fake registers): an import → check → *overené*; a hand edit → *upravené ručne* with the register's value shown.

## Blocked by

- 01 — A client company's profile is its Adresár subject
