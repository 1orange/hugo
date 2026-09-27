# 07 — The Omega file: invoices and partners

Type: AFK
Status: ready-for-agent
User stories: 32, 33, 34, 37, 38, 39, 41, 42

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The finish line, first for invoices (ADR 0019). From the month screen she downloads **one TXT file
per company-month** that she imports into Omega. This slice writes its first two sections:
`R00 T04` partners and `R00 T01` invoices. Slice 08 adds receipts.

End to end: every **confirmed** invoice of the month — typed by hand or extracted — goes into the
`T01` section, issued invoices as type 0 and received invoices as type 14. Every counterparty those
invoices name goes into the `T04` section first: name, address, IČO, DIČ and IČ DPH, filled by IČO
through the `CompanyRegister` port and stored as partners, or taken from the document alone for a
foreign partner with no register. Only confirmed documents appear (ADR 0010); her own firm's
Omega-issued invoices are simply marked not relevant and never reach the file.

The file carries **data, never accounting**: no accounts, no `typ DPH`, no KV DPH section, no cost
centres. Format per ADR 0019 and the vendored spec: Windows-1250, TAB, CRLF, `DD.MM.RRRR`, every
amount with a dot, comma-formatted fields left empty, mandatory fields always written, optional ones
only with a value, VAT in Omega's fixed rate slots with one item per rate. Free text is shortened to
Omega's column sizes; an identifier, number or amount that would not fit **holds the document back**
with the reason.

Every document gets a **stable export number** with a distinctive prefix the first time it is
written, and keeps it. The supplier's own number travels as `VS`. Regenerating the month's file
therefore produces the same numbers, and Omega's *Pridať neexistujúce* skips what an earlier import
brought in. Before downloading, the screen lists what is included and what is held back, and why.

The `T01` writer is tested against a **golden file**: the six `spring` May issued invoices, typed or
fixture-loaded, must reproduce the data columns of her own Omega export.

## Acceptance criteria

- [ ] The month screen offers one file per company-month with a `T04` section followed by a `T01` section
- [ ] Only confirmed documents are included; documents marked not relevant never are
- [ ] Issued invoices are type 0 and received invoices type 14
- [ ] Every counterparty named by an included invoice appears in `T04`, filled from the registers by IČO or from the document for a foreign partner, and partners are stored for reuse
- [ ] No account, `typ DPH`, KV DPH section or cost-centre field is written
- [ ] Output is Windows-1250, TAB-separated, CRLF-terminated, with `DD.MM.RRRR` dates and dot decimals
- [ ] VAT is written into the correct fixed slots (19, 23, 5, zero, exempt) with one item per rate
- [ ] Free text is shortened to its column size; an overlong identifier holds the document back with the reason shown
- [ ] Each document keeps a stable, prefixed export number across regenerations, and numbers never collide within a company
- [ ] The supplier's own number is carried as `VS`
- [ ] `exported_at` and the export batch are recorded, and an export event lists what was included and held back
- [ ] Golden file: the six `spring` May issued invoices reproduce the data columns of `eport OF .txt` (private fixture; skipped when absent)
- [ ] Integration test: a month with confirmed, dismissed and held-back invoices produces the expected file, and regenerating it yields identical export numbers

## Blocked by

- 06 — Invoice fields and derived roles
