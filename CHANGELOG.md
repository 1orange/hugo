# Changelog

What changed in Hugo, newest first, one section per merged pull request. The office reads the same
changes in Slovak on the *Novinky* page (`src/modules/release-notes.ts`); keep both in step.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Hugo has no version
numbers; a release is a merge to `main`.

## [Unreleased] — PR #3, second feedback round (PRD 0007)

### Added
- Every unclosed month in the reading window is read in the background after each sweep, in priority
  order: the opened month, then last and this month, then older months newest first. *Čítať doklady
  od* in Settings (default: January of the booking year). (0007/01)
- Queue screen: waiting documents per company and month, with an estimated finish time (0007/02),
  and the Drive push status: channel expiry, last notification, last sweep, a warning when silent
  for over 24 h (0007/03).
- *Chýba mesačná štruktúra*: a blocking structure issue for a client without `YYYY_MM` folders for
  the booking year, naming the layout found. (0007/06)
- Company visibility follows Google Drive sharing (ADR 0023): each client folder's sharing is read
  and stored; a company is shown only to the people its folder is shared with, on every screen,
  action, export, the queue, the activity log and the live event stream. *Prístup z Drive* in
  Settings. (0007/08, 10, 11)
- Bank statements appear in the document list, in their own group, with preview and decision; never
  read, never exported. (0007/12)
- The variable symbol is filled from the document number's digits when empty (`SK-26001` →
  `26001`), marked derived; the Omega export uses the same digits. (0007/13)
- *Prevziať z profilu* for the client's own party. (0007/14)
- Late arrivals: an upload into a month no longer booked is a late arrival too, proposed for the
  booking month (ADR 0006 amended).
- This changelog and the *Novinky* page.

### Changed
- One folder-type rule for every month: exact name, older name, near-miss repair, then the code.
  Before 2027 only `01`, `02`, `03` and `07` are read by number. (0007/05, ADR 0007)
- *Firmy* opens on the booking month (the previous one); *Otvorené mesiace* is `?month=open`.
  (0007/07)
- *Číslo dokladu* is labelled *Číslo dokladu KV DPH*. (0007/13)
- Late arrivals go to the booking month (else the next unclosed month, else the open month), not the
  open month.
- The QR retry's streak filter is linear-time, with byte-identical output. (0007/15)

### Removed
- *Moje firmy*, the per-browser company list: Drive sharing replaces it. (0007/10)

### Fixed
- Scanned PDFs reach OCR: JBIG2 images are decoded, large images are awaited, 1-bit images are
  unpacked. Before, such a scan reached OCR with no page.
- An eKasa receipt filed among documents (`bloček_O-…` in 06) is read by its UID instead of failing
  as "The PDF has no extractable text layer".
- Companies appear on the first page load after a fresh database, instead of waiting for the poll.
- No libheif or valkey-glide warnings on every compile.

### Migrations
`0014` Drive push status, `0015` company sharing, `0016` reading window start, `0017` late
arrivals since. All additive.

## 2026-11-16 — PR #2, the Adresár as company profiles (issues 0006)

### Changed
- A client company's profile is its subject in the Adresár; `company_profiles` is removed.
- The client sheet import writes the Adresár, never replacing register values silently.

### Added
- Client subjects are checked against the registers and VIES; each identity field shows
  *overené*, *upravené ručne* or *neoverené*.
- Clients in the sheet without a Doklady folder become office clients in the Adresár.

## 2026-11-16 — PR #1, office drive structure, fast sweeps and faster reading (PRD 0004, issues 0005)

### Added
- The office's shared-drive layout (accountant → client → month → type), accountant groups on
  *Firmy*, the structure check and folder repair.
- Client sheet import into company profiles.
- Reading in two lanes (reading and model), the model lane sized from the server's slots, and where
  each document's time goes on the queue screen.

### Changed
- Sweeps read Drive's change log instead of listing every file (~75 s → ~1 s).
- Hugo no longer creates folders; the office pre-creates the year.
- The Apple-style redesign.
