# 09 — Fill company profiles from the office's client sheet

Type: AFK
Status: done

## What to build

The office keeps a client sheet (*Klienti*). It has one row per client, with these columns:

- **Client:** Klient (her short name), Oficiálny názov, Právna forma.
- **Identity:** IČO, DIČ, IČ DPH.
- **VAT:** Registrácia DPH (§4 / §7a / neplatiteľ), Platiteľ DPH od, Obdobie DPH (mesačne / štvrťročne).
- **Register:** Sídlo, Stav subjektu (aktívny / pozastavený do … / zaniknutý …).
- **Office:** Vedie (Eva / Katarína / Archív), Spolupráca (aktívna / ukončená), ID priečinka Doklady.
- **Aktualizované:** the date the row was last filled.

The sheet contains client data. It is uploaded, never committed to the repository.

In *Nastavenia*, she uploads the sheet as CSV. Hugo first shows a preview, then writes only what she
confirms. Each row is matched to a company:

1. by *ID priečinka Doklady* = the company's Drive folder id;
2. otherwise by IČO, against an existing company profile;
3. otherwise by Klient = the company's name (diacritics and case ignored), shown as a guess she confirms.

For a matched row with an IČO, the company profile is filled: legal name, address, IČO, DIČ, IČ DPH,
country SK, with the source "client sheet". On the 2026-11-16 sheet, all 40 rows with a folder id match
a company, with the same accountant group. 32 of them carry an IČO.

The preview lists:

- **new profiles** — companies that get a profile for the first time;
- **changed fields** — the old and new value of each field;
- **unchanged rows**;
- **rows without an IČO**, which are not written;
- **unmatched rows**, which are only reported (slice 11);
- **disagreements:** *Vedie* differs from the company's Drive group; *Spolupráca* is ukončená but the
  company is not in Archív; *Stav subjektu* says zaniknutý for an active client (4 rows on that sheet).

A profile she saved by hand keeps her values unless she ticks the field in the preview. Every
confirmed write lands in the activity log.

## Acceptance criteria

- [ ] A pure module parses the sheet (quoted fields, Slovak headers in any column order) and matches rows: folder id, then IČO, then name. Table-driven unit tests cover each match path, a missing column, and a malformed IČO or IČ DPH (validated as the profile form does).
- [ ] The preview shows new, changed, unchanged, without-IČO, unmatched and disagreeing rows, and nothing is written before she confirms.
- [ ] Confirmed rows create or update company profiles, with an "ImportedFromClientSheet" activity event.
- [ ] Hand-saved profile fields are kept unless ticked.
- [ ] Integration test on PGlite with a fixture sheet of made-up companies (never the real sheet). A UI test covers preview and confirm.

## Blocked by

None - can start immediately
