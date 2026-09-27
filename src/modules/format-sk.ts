/**
 * Slovak presentation helpers. The whole UI is Slovak because she is the only
 * user and the documents, folders and accounting vocabulary already are.
 *
 * Everything here is pure and formats for display only — never parse a value
 * back out of one of these strings. Amounts keep the literal the document
 * printed (see `money.ts`); only separators and units are added here.
 */

const MONTH_NAMES = [
  "január",
  "február",
  "marec",
  "apríl",
  "máj",
  "jún",
  "júl",
  "august",
  "september",
  "október",
  "november",
  "december",
] as const;

const MONTH_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "máj",
  "jún",
  "júl",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

const MONTH_KEY_PATTERN = /^(\d{4})_(\d{2})$/;

export type ParsedMonthKey = { year: number; month: number };

export function parseMonthKey(monthKey: string): ParsedMonthKey | null {
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

/** `2026_07` → `júl 2026`. Falls back to the raw key so a bad row still renders. */
export function monthLabel(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }
  return `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

/** `2026_07` → `júl`, for the month rail where the year is already shown. */
export function monthShortLabel(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }
  return MONTH_SHORT[parsed.month - 1]!;
}

export function monthKeyYear(monthKey: string): number | null {
  return parseMonthKey(monthKey)?.year ?? null;
}

/**
 * Slovak has three plural forms: 1, 2–4, and everything else including 0.
 * `pluralSk(5, ["doklad", "doklady", "dokladov"])` → `dokladov`.
 */
export function pluralSk(
  count: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const absolute = Math.abs(count);
  if (absolute === 1) {
    return forms[0];
  }
  if (absolute >= 2 && absolute <= 4) {
    return forms[1];
  }
  return forms[2];
}

export function countWithNoun(
  count: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  return `${count} ${pluralSk(count, forms)}`;
}

export const DOKLAD_FORMS = ["doklad", "doklady", "dokladov"] as const;
/** Verb agreement: "1 doklad čaká", "2 doklady čakajú", "5 dokladov čaká". */
export const CAKA_FORMS = ["čaká", "čakajú", "čaká"] as const;

/** `awaitingPhrase(2)` → `2 doklady čakajú`. */
export function awaitingPhrase(count: number): string {
  return `${countWithNoun(count, DOKLAD_FORMS)} ${pluralSk(count, CAKA_FORMS)}`;
}

export const PRIECINOK_FORMS = ["priečinok", "priečinky", "priečinkov"] as const;
export const SUBOR_FORMS = ["súbor", "súbory", "súborov"] as const;

const BRATISLAVA = "Europe/Bratislava";

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Bratislava-local calendar parts. `sk-SK` officially spaces its dates
 * (`24. 7. 2026`), but every invoice and eKasa slip she reads prints
 * `24.07.2026`, and the date field parses that shape too — so the UI matches
 * the documents rather than the locale.
 */
function localParts(date: Date): { day: string; month: string; year: string } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRATISLAVA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = iso.split("-");
  return { day: day!, month: month!, year: year! };
}

/** `24.07.2026` in her timezone. */
export function formatDate(iso: string | null | undefined): string {
  const date = parseInstant(iso);
  if (!date) {
    return "—";
  }
  const { day, month, year } = localParts(date);
  return `${day}.${month}.${year}`;
}

/** `24.07.2026 15:08` in her timezone. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parseInstant(iso);
  if (!date) {
    return "—";
  }
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function formatTime(iso: string | null | undefined): string {
  const date = parseInstant(iso);
  if (!date) {
    return "—";
  }
  return new Intl.DateTimeFormat("sk-SK", {
    timeZone: BRATISLAVA,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function calendarDayIndex(date: Date): number {
  // Day boundaries must be hers, not UTC's — an upload at 23:30 Bratislava is
  // "dnes" until midnight local, and UTC would call it yesterday half the year.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRATISLAVA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Math.floor(Date.parse(`${parts}T00:00:00Z`) / 86_400_000);
}

/**
 * Chase-list wording: recent uploads read as "dnes 09:02", older ones fall back
 * to a plain date. Deliberately never says "pred chvíľou" — she wants to know
 * which day a client last sent something, not how many seconds ago.
 */
export function formatUploadMoment(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseInstant(iso);
  if (!date) {
    return "—";
  }

  const days = calendarDayIndex(now) - calendarDayIndex(date);

  if (days <= 0) {
    return `dnes ${formatTime(iso)}`;
  }
  if (days === 1) {
    return `včera ${formatTime(iso)}`;
  }
  if (days <= 6) {
    return `pred ${countWithNoun(days, ["dňom", "dňami", "dňami"])}`;
  }
  return formatDate(iso);
}

/** Sweep freshness in the app bar: "pred 4 min", "pred 2 h", or a date. */
export function formatSweepAge(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseInstant(iso);
  if (!date) {
    return "Drive ešte nebol načítaný";
  }

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);

  if (minutes < 1) {
    return "Drive načítaný práve teraz";
  }
  if (minutes < 60) {
    return `Drive načítaný pred ${countWithNoun(minutes, ["minútou", "minútami", "minútami"])}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Drive načítaný pred ${countWithNoun(hours, ["hodinou", "hodinami", "hodinami"])}`;
  }

  return `Drive načítaný ${formatDateTime(iso)}`;
}

/**
 * The two-digit prefix of a canonical folder name (`02 Prijaté faktúry` → `02`),
 * used as the compact filter-chip label. Returns the whole name when there is
 * no prefix, so a non-canonical slot still labels itself.
 */
export function folderSlotPrefix(folderSlot: string): string {
  const match = /^(\d{2})\s/.exec(folderSlot);
  return match ? match[1]! : folderSlot;
}
