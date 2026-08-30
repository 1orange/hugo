# KROS Omega import reference

Vendored rather than linked because the reference this project started from — `ImportExport_20_60.xls`
at kros.sk/66711 — now 404s. Link rot here is demonstrated, not hypothetical, and these files are the
authority for the exporter (ADR 0014).

| File | What it is |
|---|---|
| `ImportExport_28_00_2025.xls` | The import/export specification for documents from 2025 onward. Sheet `EUD` is the `T00` format the exporter targets. |
| `typy_sum_2025.xlsx` | VAT "sum type" codes, needed for the VAT fields on `R01`. |
| `Import_a_export_2025.pdf` | The click-path walkthrough of the import dialogue in Omega. |

Retrieved 2026-08-30 from `ftpkros.sk/files/documents/general/omega/2025/FAQ/`, reachable without a
login. Landing page: [akademia.kros.sk — Import a export údajov z iného softvéru pre doklady od roku
2025](https://akademia.kros.sk/faq/podvojne-uctovnictvo/import-a-export-udajov-z-ineho-softveru-pre-doklady-od-roku-2025/).

Two things about the spreadsheet that are easy to miss and cost time:

- **Mandatory fields are marked by cell background colour, not by text.** Yellow is mandatory, orange
  is mandatory under certain conditions. Reading the sheet as plain values loses that entirely, so
  read it with formatting on.
- **The spec is for Omega 28.00, saved November 2024.** The shipping version is 29.20 (April 2026), so
  it trails by roughly six releases.

The pre-2025 spec (`Import_24_60.xls`, for documents up to 2024) is deliberately not vendored: her
corpus starts in 2026. It is at `ftpkros.sk/files/documents/general/omega/2021/FAQ/` if ever needed.

Not vendored either: the ISDOC 6.0.2 schema, since ADR 0014 uses ISDOC only for passing an original
supplier file through untouched, never for generating one.
