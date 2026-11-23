# PRD 0007 — Read everything as it arrives, Drive-shared visibility, structure issues and workbench shortcuts

Status: ready-for-agent
Primary users: the office's accountants, each working a subset of the client companies in the shared drive
Continues: PRD 0004 (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`), issues 0005 and 0006
ADRs: amends ADR 0007 (canonical folder names), ADR 0011 (authentication; supersedes its 2026-11-11
amendment), ADR 0013 (document-centric model: statements presence-only), ADR 0015 (Slovak workbench UI),
ADR 0020 (read documents as they arrive); introduces ADR 0023 (company visibility follows Drive sharing).
All amendments are dated 2026-11-23.

> This PRD comes from the office's second feedback round (2026-11-23) and a pipeline speed investigation.
> Hugo stops waiting for someone to open a month: every unread document in the reading window is
> queued as soon as Drive reports it. Folder types are read by one rule in every month, so every
> client whose folders differ only by name is read; a client whose Drive lacks the month structure
> altogether is shown as a structure issue to fix in Drive. Which companies an accountant sees
> is decided by Google Drive sharing, not by a filter in the browser. The home screen opens on the
> month being booked, the previous one. Bank statements appear in the document list. The document
> workbench gets a *Prevziať z profilu* button, a variable symbol filled from the document number,
> and a clearer label for the document number.

---

## Problem Statement

**Documents uploaded to Drive show up in Hugo a day late.** The office uploaded documents and saw
them in Hugo only the next day, after opening that client's month. They believe documents are only
read when a month is clicked, and they are mostly right. Drive push (the webhook) and the 15-minute
poll exist (ADR 0020), but after each sweep Hugo queues only each company's single *open month*: the
newest unclosed month that is not in the future. The office pre-creates all of 2026, so in November
the open month is `2026_11`. Clients spend November uploading **October's** documents into `2026_10`,
and nothing in the background ever queues `2026_10`. Those documents wait until someone opens October
on the month screen, which queues and raises that month. To the office, a document "arrives" when
someone happens to click on it.

**Clients with a historic Drive layout are invisible.** The settings screen says folder types are read
by code (01–08) from January 2027 and by name before that. The office asked for the code rule now, "so
that we see the documents of all clients, including those with the historic folder structure". An
investigation of the live shared drive (2026-11-23, 20,977 items, 40 client folders) found the folder
*names* are not what hides these clients: since 2025 the current naming rules already classify every
month subfolder except three folders holding 25 files. The real cause is **structure**. Hugo only
recognises `Client / YYYY_MM / types`, but:

| Layout | Clients | 2026 files |
|---|---|---|
| `Client / YYYY_MM / types` (recognised) | 19 | ~3,300 |
| `Client / YYYY / YYYY_MM / types` (months inside a year folder) | 1 | ~295 |
| `Client / YYYY / types` (a year folder, no month folders) | 8 | ~265 |
| `Client / types` (type folders directly in the client, no year, no month) | 5 | ~530 |
| empty client folder (not set up yet) | 8 | 0 |

So 14 of the 32 clients with documents (≈1,100 files in 2026) contribute nothing to Hugo today, and
Hugo does not say so: they simply look like clients with nothing uploaded. The 8 empty clients look
the same. The office's position (2026-11-23): structure versions differ mainly by name, and names Hugo
should handle; a client missing the month structure altogether is an issue the office fixes in Drive,
so Hugo must show it.

**Everyone sees every company unless they build their own filter.** The company list (*Firmy*)
narrows by accountant group folder ("Eva – doklady klientov") or by a hand-picked *Moje firmy* list
kept in the browser. Neither reflects who actually works on a client, and both have to be maintained
by hand per browser. The office wants Google Drive to be the single source of truth: if a person's
Google account does not have access to a client's folder, Hugo should not show that client to them.

**The home screen opens on the wrong month.** In November the office books October. *Firmy* opens on
each company's open month, November, so every visit starts with switching months.

**Bank statements are hidden.** Statements are presence-only (ADR 0013): Hugo records that one
arrived but never lists or shows it. The office wants to see them next to the other documents. It is
practical, and they plan to import statements into Omega later.

**Small frictions in the document workbench:**

- The field *Číslo dokladu* holds the number that goes into the VAT control statement (KV DPH). The
  office wants it labelled so.
- The *Variabilný symbol* is often missing (not printed, or not read) and is always the document
  number without its non-digits (`SK-26001` → `26001`). The office types it by hand.
- When the client's own party on a document disagrees with the client's profile, Hugo shows the
  profile's correct value in the finding ("IČO nezodpovedá profilu klienta — v profile: …"), but
  the accountant still has to copy it into the field by hand. For register mismatches there is
  *Prevziať z registra*. For profile mismatches there is nothing.

**Is the pipeline slow because of our code?** The developer asked whether part of the reading pipeline
could be sped up by porting it to Rust, or whether the model and OCR, on CPU-only hardware, are the
bottleneck. The investigation's answer is in Further Notes: the model dominates by two orders of
magnitude, and no project code is worth porting.

## Solution

**Every unread document in the reading window is queued as soon as Drive reports it.** After every
sweep, whether triggered by a Drive notification, the poll, or a page, Hugo queues every unread
document of every unclosed month from the start of the reading window (default: January of the
current booking year) up to the current month, not just the open month. Priorities keep the work in
a useful order: the month someone has open first (as today), then the booking month (the previous
month) and the current month, then older months, newest first. The backlog is a one-time cost: the
first run on a clean database reads the whole 2026 window (about a day of model time, which the office
accepts). What is read stays in the database, so afterwards Hugo only reads new files, and a new upload
is queued within about a minute of Drive reporting it. The queue screen shows the backlog per month with an
estimated time to finish, and shows whether Drive push is working.

**Names are handled; a missing structure is shown as an issue.**

- Folder types are read **by one rule in every month**: an exact current name, then an accepted older
  name (old numbering still means what it meant, so `05 Platby kartou` stays a receipt, not a travel
  order), then the two-digit code, then near-miss repair. The "from January 2027" cut-over goes away.
  Every client whose folders differ only by name is read.
- A client without month folders for the current year gets a company-level **structure issue**,
  *Chýba mesačná štruktúra*, saying what Hugo found instead and what it expects. Cases: months inside
  a year folder, type folders in a year folder, type folders directly in the client folder, or an
  empty client folder. The issue shows on *Firmy* (the row's structure mark and the summary) and on the
  company's structure screen. Hugo reads no documents from such a layout and proposes no moves or
  renames there. Once the office creates the month folders in Drive and moves the documents, the next
  sweep clears the issue and the documents are read like any other.

**A company is shown to whoever its Drive folder is shared with.** Hugo reads each client folder's
sharing from Drive (people with direct access, people the parent folder or shared drive grants access
to, domain-wide grants). It shows a signed-in accountant only the companies whose folder their Google
account can open. This is enforced on the server for every company screen, action, queue entry and
export, not only on the list. The allowlist still decides who may sign in at all. *Moje firmy* goes
away. The group chips stay for someone who sees companies from more than one group.

**The home screen opens on the booking month**, the previous calendar month on the office's clock
(in November, October; in January, December of the previous year). The month picker and *Otvorené
mesiace* stay available.

**Bank statements appear in the month's document list** with a preview, under their own type. They are
not read or exported yet. The accountant can mark one checked or not relevant, and the chase list
keeps using their presence as today.

**Workbench shortcuts:**

- *Číslo dokladu* is labelled **Číslo dokladu KV DPH**.
- An empty *Variabilný symbol* is filled with the document number's digits, as a derived value the
  accountant can overwrite. The Omega export uses the same digits-only value when the VS is empty.
- **Prevziať z profilu** appears on the client's party when it disagrees with the client's profile, and
  writes the profile's name, IČO, DIČ and IČ DPH into that party in one click.

## User Stories

### Reading as documents arrive

1. As an accountant, I want a document a client uploads into last month's folder to be read without
   anyone opening that month, so that it is ready when I get to it.
2. As an accountant, I want a document uploaded in the morning to be ready to work on the same
   morning, so that I never wait until the next day for Hugo to notice it.
3. As an accountant, I want Hugo to queue new uploads within about a minute of Drive reporting them,
   so that "uploaded" and "in Hugo" mean the same thing in practice.
4. As an accountant, I want uploads to be picked up within fifteen minutes even when Drive's push
   notifications fail, so that a missed notification never costs a day.
5. As an accountant, I want every unclosed month from the start of the reading window to be kept read,
   so that late documents for older months are also ready.
6. As an accountant, I want closed months to stay untouched by background reading, so that what I have
   closed does not change under me.
7. As an accountant, I want the month I have open to be read first, so that the screen I am looking at
   fills in before anything else.
8. As an accountant, I want the booking month (last month) and the current month read before older
   months, so that the backlog never delays today's work.
9. As an accountant, I want older months read newest first, so that the backlog reaches recent months
   before ancient ones.
10. As an accountant, I want receipts read before invoices at each priority level (as today), so that
    the fast documents never queue behind slow ones.
11. As an office manager, I want to set how far back Hugo reads on its own (*Čítať doklady od*), so
    that years nobody books any more do not occupy the model for days.
12. As an accountant, I want a month older than the reading window to still be read when I open it,
    so that I can work on it when needed.
13. As an accountant, I want the queue screen to show how many documents are waiting per company and
    month, so that I know what is not ready yet.
14. As an accountant, I want an estimate of how long the waiting documents will take, so that I know
    whether to wait or work on something else.
15. As an office manager, I want the queue screen to show whether Drive push is active, when its
    channel expires and when the last notification and sweep happened, so that a silently broken
    webhook is visible.
16. As an operator, I want the backlog read once, on the first run against a clean database, without
    anyone doing anything, so that Hugo is current afterwards and only reads new files from then on.
17. As an accountant, I want a document queued twice (by a notification, the poll and a page) to be
    read once, so that the model's time is not wasted.
18. As an operator, I want a restarted worker or a lost Redis to re-queue whatever was waiting on the
    next sweep, so that no document is forgotten.
19. As an operator, I want the background pass to be one cheap database query rather than a loop per
    company and month, so that running it every sweep costs nothing noticeable.

### Folder names and structure issues

20. As an accountant, I want a client without month folders for the current year flagged as
    *Chýba mesačná štruktúra*, so that I know its documents are not in Hugo and why.
21. As an accountant, I want the issue to say what Hugo found instead (months inside a `2026` folder,
    type folders in a `2026` folder, type folders directly in the client folder, an empty folder), so
    that whoever fixes it knows what to change.
22. As an accountant, I want the issue to say what Hugo expects (`YYYY_MM` folders directly in the
    client folder, with the type folders inside), so that the fix is unambiguous.
23. As an accountant, I want the issue visible on the *Firmy* row and counted in the summary, so that
    I see it without opening each client.
24. As an accountant, I want the issue listed on the company's structure screen with the folders
    found, so that I can go to Drive and fix it.
25. As an accountant, I want the issue to clear by itself on the next sweep once the month folders
    exist, and the moved documents to be read then, so that fixing Drive is all it takes.
26. As an accountant, I want Hugo to read nothing from a layout it does not recognise and to propose
    no moves or renames there, so that it never misplaces a client's documents.
27. As an office manager, I want a client archived in the archive group not to raise the issue, so
    that old clients do not clutter the list.
28. As an accountant, I want month subfolder types read by the same rule in every month (exact name,
    accepted older name, then code), so that a folder like `05 Iné` or `04` is no longer ignored.
29. As an accountant, I want older folder names to keep their older meaning (`05 Platby kartou` is
    receipts, `06 Iné doklady` is other documents), so that reading by code never misfiles a historic
    folder.
30. As an accountant, I want `Bločky` and `08 Cestovné náhrady`, seen on the live drive, recognised as
    their types, so that their documents appear.
31. As an accountant, I want the settings screen to stop describing a January 2027 cut-over, so that
    it describes what Hugo does.
32. As an accountant, I want a client with the structure issue to show one issue, not a list of
    every missing month and type folder, so that the real problem is not buried.
33. As an accountant, I want older years in year folders beside correct `2026_xx` months (e.g.
    `2023`, `2024`, `2025` folders) not to raise the issue, so that clients already moved to the new
    structure are not flagged for their archive.
34. As an accountant, I want empty client folders (not set up yet) still listed, with the issue, so
    that I can see who is still missing.
35. As an accountant, I want the issue to count as blocking, so that a flagged client never looks
    like one with nothing to do.

### Visibility from Drive sharing

36. As an accountant, I want to see only the companies whose Drive folder is shared with my Google
    account, so that my list is exactly my clients.
37. As an office manager, I want to control who sees which company only by sharing in Google Drive,
    so that there is one place to manage access.
38. As an office manager, I want sharing an accountant's group folder ("Eva – doklady klientov") with
    them to show all its companies to them, so that one share covers a whole portfolio.
39. As an office manager, I want shared-drive members to see every company, so that the office's
    administrators keep the full view.
40. As an office manager, I want a domain-wide share to count for everyone in that domain, so that
    sharing with the office's domain works as expected.
41. As an accountant, I want a company I lose access to in Drive to disappear from Hugo within fifteen
    minutes or when I press *Obnoviť*, so that revoking access in Drive revokes it in Hugo.
42. As an accountant, I want a company newly shared with me to appear within fifteen minutes or on
    *Obnoviť*, so that I can start at once.
43. As an office manager, I want a company that is not shared with someone to be unreachable for them
    by URL as well (month, profile, structure, activity, export, actions), so that the restriction is
    real, not cosmetic.
44. As an accountant, I want the queue screen and the activity log to show only my companies'
    documents, so that I do not see other portfolios' work.
45. As an accountant, I want the summary counts on *Firmy* to count only my companies, so that they
    reach zero when my work is done.
46. As an office manager, I want the allowlist to still decide who may sign in at all, so that
    sharing a client folder with a client never grants them Hugo.
47. As an accountant, I want a clear message when no company is shared with my account, saying to ask
    for Drive access, so that an empty list is not a mystery.
48. As an operator, I want Hugo to keep the last known sharing when Drive's sharing cannot be read for
    a moment, and show nothing at all before it has ever been read, so that a Drive error never opens
    everything to everyone.
49. As an accountant, I want the group chips kept when I see companies from more than one group, so
    that I can still narrow the list.
50. As an accountant, I want *Moje firmy* removed, so that there is no second, hand-maintained notion of
    my companies.
51. As an office manager, I want sharing granted to a Google Group to be listed as unsupported on the
    settings screen, so that I know to share with people directly.
52. As an accountant, I want email addresses compared case-insensitively, so that capitalisation never
    hides a company.

### Home screen month

53. As an accountant, I want *Firmy* to open on the previous month, so that I land on the month I am
    booking.
54. As an accountant, I want the previous month computed on the office's clock, so that a visit just
    after midnight on the 1st opens the right month.
55. As an accountant, I want a company row to link to that company's booking month, so that one click
    takes me to the work.
56. As an accountant, I want to still switch to any other month or to *Otvorené mesiace*, so that I can
    review other months.
57. As an accountant, I want a company with no folder for the booking month to show that the month is
    missing, so that I know what to chase.

### Bank statements

58. As an accountant, I want bank statements listed in the month's document list, so that I can see
    them next to the other documents.
59. As an accountant, I want to preview a statement (PDF, image) in the workbench, so that I do not
    have to open Drive.
60. As an accountant, I want statements in their own group in the list, so that they do not mix with
    invoices.
61. As an accountant, I want to mark a statement checked or not relevant, so that the month's to-do
    count reaches zero.
62. As an accountant, I want statements never sent to OCR or the model, so that they cost no reading
    time.
63. As an accountant, I want statements left out of the Omega export for now, so that the export stays
    correct until statement import is designed.
64. As an accountant, I want XML statements listed too, so that every statement file is visible.
65. As an accountant, I want the chase list's statement presence unchanged, so that "bez bankového
    výpisu" keeps working.

### Workbench shortcuts

66. As an accountant, I want the document number field labelled *Číslo dokladu KV DPH*, so that it is
    clear which number goes into the VAT control statement.
67. As an accountant, I want an empty variable symbol filled with the document number's digits
    (`SK-26001` → `26001`), so that I do not type it.
68. As an accountant, I want the filled variable symbol marked as derived, so that I can tell it was not
    printed.
69. As an accountant, I want a printed or read variable symbol never replaced, so that a symbol that
    really differs from the number is kept.
70. As an accountant, I want a derived variable symbol to follow when I correct the document number,
    and to stop following once I type my own, so that it stays consistent without fighting me.
71. As an accountant, I want no variable symbol derived when the number has no digits or more than ten,
    so that Hugo never invents an invalid symbol; the field stays empty and flagged.
72. As an accountant, I want the Omega export to use the digits-only symbol when the field is empty, so
    that Omega never receives `SK-26001` as a VS.
73. As an accountant, I want a *Prevziať z profilu* button on the client's party when it disagrees with
    the client's profile, so that one click fixes it.
74. As an accountant, I want *Prevziať z profilu* to write the profile's name, IČO, DIČ and IČ DPH, only
    the values the profile has, so that the party matches the profile exactly.
75. As an accountant, I want values taken from the profile marked with provenance *profil*, so that I
    can see where they came from.
76. As an accountant, I want the button refused on an exported document or a closed month, as
    *Prevziať z registra* is, so that exported data is not changed.
77. As an accountant, I want the party's check to run again after taking the profile's values, so that
    the mismatch disappears at once.
78. As an accountant, I want *Prevziať z registra* and *Prevziať z profilu* shown side by side when both
    apply, so that I can choose.

### Pipeline speed

79. As the developer, I want the investigation's numbers recorded (Further Notes), so that the next
    "can we make reading faster" question starts from data.
80. As the developer, I want the QR retry's streak-closing filter made linear in the image size, so that
    a receipt whose QR fails the first decode costs a fraction of a second less, without a Rust
    toolchain in the image.

## Implementation Decisions

### Reading window and priorities (amends ADR 0020)

- **Read planner (new pure module, deep).** Input: every company's months (key, closed), the current
  instant, the office time zone, the reading-window start, and optionally the month raised by an open
  screen. Output: the months to read, each with a priority tier. Rules:
  - a month is in the window when its key is ≥ the window start and ≤ the current month, and it is
    not closed;
  - tiers: *raised* (the opened month, as today) → *recent* (the booking month and the current
    month) → *backlog* (the other months in the window, newest first);
  - receipts before documents within each tier.
  It knows nothing of Redis, Drive or the database.
- **Booking month (new pure function).** The calendar month before the current one, on the office
  clock (`Europe/Bratislava`). The read planner, the home screen and the late-arrival target share it.
- **Priorities.** BullMQ priorities become tier × kind (six levels, lower first): raised receipt,
  raised document, recent receipt, recent document, backlog receipt, backlog document. Backlog recency
  is ordered by when items are queued (newest month queued first), not by more priority levels.
  `raiseMonth` keeps working on the new levels.
- **What a sweep queues.** After every sweep (notification, poll, page `after()`), Hugo queues the
  read planner's months, replacing "the open month of every company". The pass reads the window's
  unread documents in **one store query** (files in processed slots, statements excluded, not deleted,
  in a window month, document missing or needing (re)reading) instead of one `enqueueMonthExtraction`
  call per company and month. One job per Drive file stays the deduplication.
- **Reading-window setting.** A new setting *Čítať doklady od* (`YYYY_MM`), default January of the
  booking month's year. A month before it is read only when opened (current behaviour).
- **Queue screen.** Adds the waiting documents per company and month (for the companies visible to
  the viewer), and an estimate: waiting documents needing the model × median model time of recent
  records ÷ model slots, plus the reading lane's share. Adds a *Drive* panel: push enabled or poll
  only, channel expiry, last accepted notification, last sweep.
- **Drive push in production.** `DRIVE_WEBHOOK_URL` must be set in the production config (Infisical,
  edited by the user) and its notification route reachable. The channel's last accepted notification
  time is stored (settings), so the panel can show it. The poll stays the guarantee (≤ 15 min).
- **First backlog, once.** No special mode: the first sweep on a clean database queues the window's
  backlog in tier order, and what is read stays in the database, so it is never paid again; later
  sweeps find only new or changed files. Estimated size from the live drive: ~2,400 documents in
  processed folders for 2026 (in recognised structure; less until the flagged clients are fixed), of
  which the model reads perhaps half or more. At ~48 s per model document on one slot, that is roughly
  a day of continuous reading, accepted by the office. A pipeline version bump (ADR 0017) re-reads
  open months only, as today.

### Folder types and structure issues (amends ADR 0007)

- **One classification rule for every month.** `classifyFolder` drops the 2027 cut-over: exact
  canonical name → accepted older name (the existing table, plus `Bločky` → 04 and `08 Cestovné
  náhrady` → 05) → two-digit code → near-miss repair → unknown. Accepted names take precedence over
  codes because old numbering means something else (old `05` is card receipts). The constant marking
  the code scheme's first month and the expected-slots exception for older months are reviewed. The
  "not expected before 2027" slots (05, 08) stay not expected in months before 2027, as the office's
  scripts never added them.
- **Drive tree is unchanged.** Only `Client / YYYY_MM[ …] / type` is read. Company detection by depth
  (root → group → client) is unchanged. Files elsewhere in a client folder stay unread.
- **Company layout (new pure function, deep).** From a client folder's direct children and
  grandchildren (folder names only), it returns `months` (month folders for the current year exist
  directly in the client folder) or the layout found instead: `year-months` (`2026 / 2026_10 / …`),
  `year-types` (`2026 / 02 Prijaté faktúry`), `types` (type folders directly in the client), `empty`,
  or `other`, plus the folder names that show it. Year folders for *earlier* years beside current
  `YYYY_MM` folders are `months`, not an issue. "Current year" is the booking month's year.
- **New structure deviation kind** `month-structure-missing`, company-level and `blocking`, written by
  the sweep's structure check like the existing kinds (`subfolder-missing`, `subfolder-repair`,
  `folder-unrecognised`). Its detail holds the layout found and example folder names. When it is
  present, the per-month findings for that company are suppressed (there are no months to check). It
  clears when the layout becomes `months`. Archived clients are not checked.
- **Display.** *Firmy* shows the deviation through the existing structure mark and count. The
  structure screen shows *Chýba mesačná štruktúra* with what was found, what is expected
  (`2026_01 … 2026_12` in the client folder, the type folders inside each), and a link to the client
  folder in Drive. No one-click fix: the office restructures in Drive (ADR 0006: Hugo does not create
  folders).
- **Settings copy.** The paragraph about January 2027 is replaced by the single rule.

### Company visibility from Drive sharing (new ADR 0023, supersedes ADR 0011's 2026-11-11 amendment)

- **Drive adapter.** The Drive client gains "list a folder's permissions" (`permissions.list`,
  `supportsAllDrives`, fields: type, role, emailAddress, domain, permissionDetails). Verified on the
  live drive: with the service account's access, a client folder's list includes shared-drive members
  and parent-folder grants (inherited) and direct grants.
- **Access snapshot (store).** A new table holds each company's principals: type
  (`user | group | domain | anyone`), email or domain (lower-cased), role, inherited. It is replaced
  wholesale per company on refresh. A refresh that fails keeps the previous snapshot.
- **Refresh.** On every poll, on *Obnoviť*, and when a sweep's change log reports a change to a
  company folder or a group folder (sharing changes appear there). About one Drive call per company
  per refresh.
- **Visibility rule (new pure module, deep).** `canSee(email, principals)`: true when a `user`
  principal matches the email (case-insensitive), a `domain` principal matches its domain, or an
  `anyone` principal exists. `group` principals are not expanded (that needs the Admin or Cloud
  Identity API) and are reported as unsupported. No snapshot → not visible (fail closed).
- **Enforcement.** One server-side guard, "companies visible to this session", used by: the company
  list and its summary, every company route (month, profile, structure, activity), every server action
  taking a company id, the Omega export, the queue snapshot and the event stream (events for invisible
  companies are not sent to that browser), and the activity log. An invisible company answers as not
  found. The guard is a single query with the snapshot, not a Drive call.
- **Allowlist unchanged.** The allowlist remains the sign-in gate (ADR 0011). Drive access does not
  admit anyone.
- **Office-wide screens.** The Adresár and Settings stay office-wide for every allowlisted user (the
  Adresár is a shared directory of subjects, ADR 0022).
- **Moje firmy removed.** The per-browser assignment module, its toggle and its storage are deleted.
  The group chips stay, shown only when the visible companies span more than one group.
- **Rollout prerequisite.** On the live drive today, only two shared-drive members and the service
  account have office-side access. Accountants who are not members see nothing until the office
  shares their group folder (or individual client folders) with the Google account they sign in with.
  The settings screen lists, per company, which allowlisted users can see it, so the office can check
  before and after.

### Home screen (amends ADR 0015)

- `/companies` without a month parameter shows the **booking month** for every row. *Otvorené
  mesiace* (each company's own open month) becomes an explicit option of the month picker. A
  company's link goes to the shown month. A company with no such month shows "mesiac chýba".
- The open month (ADR 0005) keeps its meaning for closing and late arrivals.

### Bank statements in the workbench (amends ADR 0013)

- Documents of the `03 Bankové výpisy` slot get document rows and appear in the month's document
  list, in their own group, with the existing preview (PDF, image; XML as text).
- Their extraction status is "not read" (a new terminal state for statements). They are never queued
  for the reading lanes, never OCR'd or sent to the model, and excluded from the Omega export.
- Decisions *confirmed* and *not relevant* apply. A statement counts in the month's to-do until
  decided. Statement presence for the chase list is unchanged.
- The office's message called statements "(05)". On the drive they are `03 Bankové výpisy` in every
  layout. No `05` folder holds statements, so the 03 slot is meant.

### Variable symbol and labels

- **Derivation (pure, in the document fields merge).** When the variable symbol is empty after
  extraction and confirmation, its value is the document number's digits (`/\D/g` removed), with
  provenance `derived`, if that leaves 1–10 digits. Otherwise it stays empty and flagged. A derived
  value is recomputed when the document number changes. A typed value (`confirmed`) stops the
  derivation, as other derived fields do (PRD 0003).
- **Omega export.** The export's fallback (VS empty → document number) uses the same digits-only
  derivation, so the raw number is never written as a VS.
- **Label.** The workbench field *Číslo dokladu* is renamed *Číslo dokladu KV DPH*. The field, its
  storage and the export column do not change.

### Prevziať z profilu

- **Offer rule (pure, beside `offersRegisterTakeover`).** `offersProfileTakeover(check)`: the
  client's party verdict has a `profile-name | profile-ico | profile-dic | profile-icdph` mismatch
  with an expected value.
- **Service.** `takePartyFromProfile(company, month, document, side)`: refused unless the stored verdict
  for the document's current values offers it, the document is not exported and the month is
  editable. It writes the profile's legal name, IČO, DIČ and IČ DPH (only those the profile has) as
  overrides with provenance `profile`, unlike the register takeover, which never writes the IČO. Then
  it re-runs the party check. It records an activity event like the register takeover.
- **UI.** A *Prevziať z profilu* button beside *Prevziať z registra* on the party fieldset, same style
  and keyboard behaviour. Its tooltip names what will be written.

### Pipeline speed (investigation outcome, ADR not needed)

- **No Rust port.** Nothing in the project's own code is on the critical path (see Further Notes).
- **Streak filter.** The QR retry's `closeLightStreaks` becomes a linear-time one-dimensional minimum
  filter (sliding window or van Herk/Gil-Werman) in TypeScript, with identical output, proven by the
  existing tests plus a randomised equivalence test against the current implementation. Low priority,
  independent of everything else.

## Testing Decisions

- **Good tests check behaviour at a module's interface:** given months, instants and settings, which
  months are read in which order; given Drive records, which company, month and slot a file lands
  in; given principals and an email, whether a company is visible. They do not assert on queries,
  job ids or component internals. The pure modules take their clock and time zone as inputs.
- **Read planner:** window bounds; closed and future months excluded; booking month across a year
  boundary (January → December); tier order; raised month first. Prior art:
  `tests/unit/modules/month-lifecycle.test.ts`.
- **Queueing integration:** a sweep that discovers a file in the booking month (not the open month)
  queues it; a closed month's file is not queued; a file queued twice is one job; the single backlog
  query returns what the per-month path returned. Prior art: `tests/unit/extraction-queue/*.test.ts`
  (PGlite), `two-lanes.redis.test.ts` and `raise-month.redis.test.ts` (Redis).
- **Folder classification:** every accepted older name keeps its slot in 2025 and 2026 months; coded
  names (`04`, `05 Iné`) resolve by code; `Bločky` and `08 Cestovné náhrady`; 2027 behaviour
  unchanged. Prior art: `tests/unit/modules/folder-taxonomy.test.ts`.
- **Company layout and the structure issue:** one fixture per layout from the live shapes
  (anonymised): `months`, `months` with older year folders beside it (no issue), `year-months`,
  `year-types`, `types`, `empty`; archived client not checked; the deviation appears, suppresses the
  per-month findings, and clears on the sweep after month folders are added, whose files are then
  discovered and queued. Prior art: `tests/unit/modules/drive-structure.test.ts`,
  `tests/unit/sweep/structure-deviations-integration.test.ts`.
- **Visibility rule:** user, inherited user, domain, anyone, group (not visible, reported), case, no
  snapshot. **Guard integration:** an invisible company is absent from the list and returns not-found
  on its routes and actions; queue snapshot filtering. Prior art: `tests/unit/auth/`,
  `tests/unit/sweep/company-groups-integration.test.ts`. The fake Drive client gains permissions.
- **Home screen month:** the booking month default and the link target. e2e. Prior art:
  `tests/e2e/assigned-companies.spec.ts` (replaced by a visibility spec with two signed-in users and
  the fake Drive's permissions).
- **Statements:** listed, previewable, never queued, excluded from export, decisions counted.
  Prior art: `tests/unit/modules/document-state.test.ts`, `tests/unit/omega-export/`.
- **Variable symbol:** derivation cases (`SK-26001`, `FA2026/0012`, no digits, 11 digits, printed VS
  kept, typed VS kept, number edited). Export fallback. Prior art:
  `tests/unit/modules/document-fields.test.ts`, `tests/unit/omega-export/`.
- **Prevziať z profilu:** offer rule; service writes IČO too, refuses when exported, closed or stale;
  provenance. Prior art: `tests/unit/modules/subject-integrity.test.ts`, the register takeover's tests
  in `tests/unit/documents/`, `tests/e2e/invoice-fields.spec.ts`.
- **Streak filter:** existing `tests/unit/modules/raster-streaks.test.ts` plus a randomised
  equivalence test (sizes, widths 3 and 5, both axes).

## Out of Scope

- Importing bank statements into Omega, or parsing them (ADR 0009 parsers stay unused).
- Expanding Google Group memberships for visibility (needs the Admin or Cloud Identity API and a
  delegated credential).
- Per-user permissions beyond visibility (roles, read-only users, recording who did what).
- Reading documents from layouts without month folders, or assigning months from document dates.
  Those clients are flagged and fixed in Drive.
- Moving, renaming or creating folders to convert a layout. The office does it in Drive.
- Changing the model, its hardware, its slots or its prompt. See Further Notes for the
  recommendations.
- Re-enabling llama.cpp prompt caching (deliberately off for determinism, ADR 0017).
- Porting any code to Rust.

## Further Notes

### Pipeline speed investigation (2026-11-23)

Method: the recorded benchmark results and ADR 0017's node measurements for the model and OCR. A new
local workload ran every reading-lane step that runs in Node (PDF attachments and text, page images,
QR with retries, image preparation for OCR, the deterministic parser) over the 71 private benchmark
fixtures, with OCR stubbed, profiled with V8's CPU profiler via `fast-anything scan` on an M4.
Production timings could not be read (no access was granted). The queue screen's per-stage records
there would confirm the model and OCR shares.

| Stage | Where it runs | Typical time per document |
|---|---|---|
| Model (Qwen3 4B Q4_0, llama.cpp, 1 slot, 4 threads, CPU) | extractor sidecar | **~48 s median**, worst ~118 s. Reading the prompt is over half; the answer is ~328 tokens at ~7.8 tok/s |
| OCR | OCR sidecar | ~2.1–2.4 s per page |
| Download from Drive | network | ~1 s |
| Everything else in Node (pdf.js, zxing-wasm QR, image prep, parsing) | worker | ~0.6 s worst case, mostly far less |
| Deterministic parser | worker | 0.1–0.8 ms |

- **The model is the bottleneck by two orders of magnitude.** One model slot reads about 75 documents
  an hour. For a document the model reads, the project's own TypeScript is under 1% of its time.
- **`fast-anything scan` found no project function worth porting.** In-Node CPU is 46% pdf.js
  (library), ~12% zxing (WebAssembly), and 23% `closeLightStreaks`, a project pixel loop that runs
  only on QR *retries*. The workload ran QR on every invoice page (no QR → every retry fires), so
  that share is an upper bound. Fixing its algorithm (story 80) saves at most a few hundred
  milliseconds on a receipt whose first decode fails. A Rust port would add a toolchain to the image
  for less.
- **What would speed reading up**, in order of effect:
  1. **Read in the background, in the right order** (this PRD). Waiting comes from when reading
     starts, not from how fast it is.
  2. **Hardware.** On CPU, more model slots do not add throughput without more cores. A GPU or an
     Apple-silicon node would cut the ~48 s several times over. That decision is the user's, outside
     this PRD.
  3. **Fewer documents through the model.** ISDOC, MOL, eKasa and text-layer receipts already skip
     it. The deterministic parser reached 74% exact-or-flagged against the model's 96%
     (`docs/deterministic-extraction-2026-10-11.md`), not enough to bypass the model.
  4. **Shorter prompt or answer.** Benchmarked 2026-11-16 (ADR 0017) and not adopted: the shorter
     answer cost accuracy.

### Live drive facts behind this PRD (read-only, 2026-11-23)

- 40 client folders across three groups. Layouts as in the Problem Statement table. 8 empty clients
  in one group.
- Month subfolders since 2025: 1,121 exact names, 838 accepted older names, 1 near-miss, 3 unknown
  (`Bločky` ×1, `08 Cestovné náhrady` ×2; 20 files).
- 2026 documents by type (all layouts, undated `types` layouts counted in): issued invoices ~530, received ~1,370, statements ~330,
  receipts ~350, other ~140, payroll ~690.
- Sharing: shared-drive members and the service account inherit access to every client. Direct grants
  on client folders are mostly the clients' own addresses. No accountant-level grants exist yet.

### Open points to confirm with the office

- Which Google account each accountant signs in with, and that their group folders will be shared
  with those accounts before the visibility change ships (otherwise they see nothing).
- The office restructures the 14 flagged clients (1 year-months, 8 year-types, 5 types) and sets up
  the 8 empty ones. Until then those clients show the structure issue and contribute no documents.
