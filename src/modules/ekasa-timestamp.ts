export type EkasaLocalTimestamp = {
  raw: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type EkasaTimestampError = {
  ok: false;
  reason: string;
};

export type EkasaTimestampResult = EkasaLocalTimestamp | EkasaTimestampError;

/**
 * Two-digit years map to 2000–2099. eKasa launched in 2019; fiscal receipts in
 * this system will not predate that window.
 */
export function expandEkasaYear(twoDigitYear: number): number {
  if (twoDigitYear < 0 || twoDigitYear > 99) {
    throw new RangeError("Year fragment must be 00–99");
  }
  return 2000 + twoDigitYear;
}

export function parseReceiptDatetimeRaw(raw: string): EkasaTimestampResult {
  const trimmed = raw.trim();
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      reason: "Timestamp must be DD.MM.YYYY HH:MM:SS in Slovak local time.",
    };
  }

  const year = Number(match[3]!);
  const month = Number(match[2]!);
  const day = Number(match[1]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);

  if (month < 1 || month > 12) {
    return { ok: false, reason: "Timestamp month is out of range." };
  }
  if (day < 1 || day > 31) {
    return { ok: false, reason: "Timestamp day is out of range." };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: "Timestamp time is out of range." };
  }

  return { raw: trimmed, year, month, day, hour, minute, second };
}

export function parseEkasaTimestampRaw(raw: string): EkasaTimestampResult {
  if (!/^\d{12}$/.test(raw)) {
    return { ok: false, reason: "Timestamp must be exactly 12 digits (YYMMDDHHMISS)." };
  }

  const year = expandEkasaYear(Number(raw.slice(0, 2)));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  const hour = Number(raw.slice(6, 8));
  const minute = Number(raw.slice(8, 10));
  const second = Number(raw.slice(10, 12));

  if (month < 1 || month > 12) {
    return { ok: false, reason: "Timestamp month is out of range." };
  }
  if (day < 1 || day > 31) {
    return { ok: false, reason: "Timestamp day is out of range." };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: "Timestamp time is out of range." };
  }

  return { raw, year, month, day, hour, minute, second };
}

function lastSundayDay(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - weekday;
}

function isDaylightSavingTimeInBratislava(
  year: number,
  month: number,
  day: number,
  hour: number,
): boolean {
  const dstStartDay = lastSundayDay(year, 3);
  const dstEndDay = lastSundayDay(year, 10);

  if (month < 3 || month > 10) {
    return false;
  }
  if (month > 3 && month < 10) {
    return true;
  }
  if (month === 3) {
    if (day > dstStartDay) {
      return true;
    }
    if (day < dstStartDay) {
      return false;
    }
    return hour >= 2;
  }
  if (day < dstEndDay) {
    return true;
  }
  if (day > dstEndDay) {
    return false;
  }
  return hour < 3;
}

/**
 * Resolve Slovak-local eKasa time to a UTC instant. The raw YYMMDDHHMISS
 * carries no timezone — it is always Europe/Bratislava local civil time.
 */
export function bratislavaLocalToUtcIso(local: EkasaLocalTimestamp): string {
  const offsetHours = isDaylightSavingTimeInBratislava(
    local.year,
    local.month,
    local.day,
    local.hour,
  )
    ? 2
    : 1;

  const utcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour - offsetHours,
    local.minute,
    local.second,
  );

  return new Date(utcMs).toISOString();
}
