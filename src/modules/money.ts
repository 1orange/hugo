export type ParsedMoney = {
  cents: number;
  literal: string;
};

export type MoneyParseError = {
  ok: false;
  reason: string;
};

export type MoneyParseResult = ParsedMoney | MoneyParseError;

// Either separator: documents print `1.20`, but she types on a Slovak keyboard
// and will write `1,20`. Exactly one separator is allowed, so a thousands-grouped
// string like `1,009.00` is still rejected rather than silently misread.
const AMOUNT_PATTERN = /^(\d{1,10})(?:[.,](\d{1,2}))?$/;

/**
 * Parse a decimal amount into integer minor units (cents). The literal source
 * string is preserved exactly — never round-trip through a float — including
 * whichever decimal separator it arrived with; `cents` is the canonical value.
 */
export function parseDecimalAmount(input: string): MoneyParseResult {
  const literal = input.trim();
  if (literal.length < 1 || literal.length > 12) {
    return { ok: false, reason: "Suma musí mať 1 až 12 znakov." };
  }

  const match = AMOUNT_PATTERN.exec(literal);
  if (!match) {
    return {
      ok: false,
      reason:
        "Suma musí byť desatinné číslo s najviac dvoma desatinnými miestami, oddelené čiarkou alebo bodkou.",
    };
  }

  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const centsFromFraction =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  const cents = Number(whole) * 100 + centsFromFraction;

  return { cents, literal };
}

/**
 * An amount read off a document, where a credit note prints `-26.83`. The
 * amounts she types stay unsigned (parseDecimalAmount).
 */
export function parseSignedDecimalAmount(input: string): MoneyParseResult {
  const literal = input.trim();
  if (!literal.startsWith("-")) {
    return parseDecimalAmount(literal);
  }
  const unsigned = parseDecimalAmount(literal.slice(1));
  return "ok" in unsigned ? unsigned : { cents: -unsigned.cents, literal };
}

/** @deprecated Use parseDecimalAmount — euro amounts use the same decimal rules. */
export function parseEuroAmount(input: string): MoneyParseResult {
  return parseDecimalAmount(input);
}

export function formatEuroFromCents(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  const formatted = `${whole}.${fraction}`;
  return negative ? `-${formatted}` : formatted;
}
