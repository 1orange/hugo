# ADR 0015 — The document workbench, in Slovak

Date: 2026-08-30
Status: Accepted
Relates to: ADR 0013 (document-centric domain model), PRD 0001 slices 21 and 22

## Context

Slice 22 built the document screen and slice 21 the company list, but both were built as the
shortest path to the acceptance criteria rather than as surfaces she lives in for hours. Read off
the code as it stood:

- The decision — the single most important act in the app — was a bare `<input type="checkbox">`
  in the left edge of a list row, inside a hidden form. Nothing labelled it and undo was the same
  checkbox again.
- The preview sat in a 480px iframe in the *narrower* column of a two-column grid under
  `max-w-7xl`. On a wide screen roughly a fifth of the glass showed the document she was reading.
- Nothing navigated between months. The company row linked to the open month and a closed month
  was reachable only by typing `/companies/3/2026_05` into the address bar.
- `[monthKey]/page.tsx` listed every document in the panel and then listed all of them *again*
  under folder headings from `view.groups`, with no actions attached.
- Four bordered panels stacked before the work started, plus a dismiss-reason input and a note
  input rendered on every row whether or not she was using them.
- The chrome was English while the folders, suppliers, amounts and field labels were Slovak.

## Decision

**One workbench per company-month.** Three panes filling the window: the document rail, the
preview, and the extracted fields. The preview is the widest column and runs the full height.

**The decision is a bar under the preview, not a control on a row.** Full width, in the path her
eye already travels after reading the document. `Potvrdiť` is filled in the same green the
confirmed state uses in the list, so the button and the resulting chip are visibly the same fact.
`Nerelevantné` opens a reason field only when she asks for it. A decided document turns the bar
into a chip with its timestamp and a single `Vrátiť`. Rows show what a document *is* and never
carry the control that changes it. Keyboard: `C`, `N`, `J`, `K`.

**Auto-advance is a setting, off by default.** Jumping to the next awaiting document after a
decision is the biggest speed win available and the easiest thing to find surprising, so she opts
in. It is a column on `settings` and a logged `AutoAdvanceChanged` event, not a client-side
preference, because it changes what the app does rather than how it looks.

**A month rail, not a dropdown.** One row of chips per year, closed months included and visibly
distinct, with a year stepper that only appears when there is more than one year. Twelve chips is
the worst case for one year, which fits without scrolling.

**The UI is Slovak throughout**, including validation messages and event summaries from the pure
modules. She is the only user and the entire domain — folder names, `IČ DPH`, `SPOLU`, `NA ÚHRADU`
— already is. `format-sk.ts` holds month names, the three-form plural rules and the date shapes;
dates render as `24.07.2026` rather than the locale's spaced `24. 7. 2026`, because that is what
every invoice and eKasa slip prints and what the date field parses.

**Light theme only** for now.

**The chase list is a table sorted by who owes her something.** `chase-list.ts` derives one of six
states from presence alone — `silent`, `no-statement`, `no-proofs`, `decide`, `ready-to-close`,
`idle` — and the last column names the next step in words rather than a lifecycle stage, so she
does not have to translate before acting. Statement presence and last-upload are queries over
`files` (which already stores `03` with its `folderSlot` and Drive's created time), so slice 20's
core figure needed no new table and no denormalised counter.

**The four panels collapse into two rows of chrome.** Close, reopen, sweep freshness, refresh,
missing folders and folder repair all live in the app bar and the month rail; folder problems sit
behind a chip that reads `Priečinky v poriadku` or names the count. The duplicate document list is
deleted.

## Consequences

- Presentation only: no schema change beyond the one settings column, no new server action, and no
  change to how a decision is stored or who is allowed to set one (ADR 0010 stands).
- `document-panel.tsx` splits into `document-rail`, `document-stage`, `decision-bar`,
  `fields-panel` and the `document-workbench` that owns their state. `month-lifecycle-panel.tsx`
  is gone, folded into `month-rail.tsx`.
- Every `data-testid` survives. `document-confirm-<id>` and `document-dismiss-<id>` moved from the
  row checkbox onto the decision-bar buttons, so the Playwright specs needed a select-then-decide
  step rather than a rewrite.
- Fields autosave on blur, with an explicit `Uložiť údaje` that also reports unsaved state. The
  parser's existing arithmetic self-check is surfaced as a line she can read instead of a warning
  above the form.
- Awaiting is now counted over documents whose file still exists, rather than over every row in
  `documents`. A deleted file could previously keep the count the whole dashboard rests on from
  reaching zero.
- Translating the pure modules means their messages are asserted in Slovak in the unit tests. That
  is the cost of putting user-facing strings in pure modules; the alternative — a translation layer
  at the UI boundary — buys nothing for a single-user, single-language app.

## Alternatives considered

- **Decision as a sticky footer on the fields column.** Keeps editing and confirming in one place,
  which suits an invoice she corrects before confirming. Rejected because the button ends up small
  again, which is the problem this ADR exists to fix.
- **Auto-advance on by default.** Faster on the first day, disorienting on the first hour.
- **A month dropdown.** Cheaper, and correct if a client ever has forty months. Revisit then.
- **Keeping English chrome.** Consistent with the code, inconsistent with everything she reads.

---

## Amendment, 2026-08-30 — four corrections from first real use

Four things surfaced the first time the screens were used against a real Drive rather than the
fixture. Recorded here rather than as a new ADR because each one adjusts a decision above rather
than replacing it.

### The chase list can be pointed at any month

The landing screen only ever reported each company's *own* open month, which is the daily question
but not the only one. It now takes an optional month: with no month picked each row reports that
company's open month as before, and picking a calendar month switches every row to it. Two new
states fall out and both are honest rather than blank — `closed` for a month already filed, and
`no-month` for a client who has no folder for the month she picked. Neither is an action, so both
sort below the work and draw back in grey.

`withoutStatement` in the summary no longer counts a closed month: chasing a client for a statement
in a month she has already filed is noise.

### Any month can be closed, not only the newest

`closeCompanyMonth` required `getOpenMonthKey(companyId) === monthKey`, so a month that fell behind
— finished late, after a newer one was already being worked — could never be closed at all. The
guard is gone. ADR 0005 anchors the lifecycle on the explicit click and *derives* the open month as
the newest without a `closedAt`; that derivation is unaffected by closing an older month out of
order. `assertMonthEditable` already rejects an already-closed month, so nothing else was needed.

Closing with documents still undecided is now allowed behind a one-click confirm rather than a
disabled button. The button was disabled whenever anything was awaiting, which is right for the
current month and a trap for an old one. Reopening is one click, so a soft confirm is the
proportionate guard.

### A repaired folder is not an unresolved problem

After a rename is applied, the sweep updates the folder name and it classifies as `canonical` —
but `getActiveMutationForFolder` keeps returning the applied, un-undone mutation, because undo
stays available (ADR 0006). The month screen counted *any* folder carrying a mutation as needing
attention, so a folder she had already fixed kept showing as outstanding with `Vrátiť` as the only
thing on offer.

Folders now split three ways: `repair-candidate` and `unknown` need a decision and are counted;
`canonical` with an applied mutation is a finished action listed under *Premenované aplikáciou*
with its undo, and is not counted. The health chip reads `Priečinky v poriadku` when only repaired
folders remain.

### "Waiting to be processed" was a promise the app could not keep

Extraction is scheduled when a month is opened, but it is fire-and-forget: the page renders before
the parsers finish and nothing pushes the results down, so the values only appeared after some
later action happened to refresh the page. It looked like parsing started on click. Two fixes:

- The workbench polls while anything is genuinely pending, with a tick budget that resets whenever
  the count moves, so a parse stuck on a Drive outage stops rather than polling forever. The rail
  bar shows `Spracúvam N…` while it runs.
- More importantly, `pending` was being shown for documents **no parser will ever read**. Only the
  eKasa text-layer parser exists, and only for PDFs in `04` and `05`; invoice extraction is slice
  11 and OCR is deferred (ADR 0008). Every invoice therefore sat at "waiting to be processed"
  forever, which both lied and made a real parse indistinguishable from one that was never going
  to happen. `hasAutomaticExtraction` now decides, and a document nothing will read says
  `Vyplň ručne` from the start.

Discovery is also kicked off for each company's open month when the **chase list** loads, so the
receipts that arrived since her last visit are usually already read by the time she clicks into a
client. Already-attempted files are skipped, so a repeat visit costs nothing.
