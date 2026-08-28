export type ParsedMoney = {
  cents: number;
  literal: string;
};

export type MoneyParseError = {
  ok: false;
  reason: string;
};

export type MoneyParseResult = ParsedMoney | MoneyParseError;

const AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/**
 * Parse a decimal amount into integer minor units (cents). The literal source
 * string is preserved exactly — never round-trip through a float.
 */
export function parseDecimalAmount(input: string): MoneyParseResult {
  const literal = input.trim();
  if (literal.length < 1 || literal.length > 12) {
    return { ok: false, reason: "Amount must be 1–12 characters." };
  }

  const match = AMOUNT_PATTERN.exec(literal);
  if (!match) {
    return { ok: false, reason: "Amount must be a decimal with up to two fractional digits." };
  }

  const whole = match[1]!;
  const fraction = match[2] ?? "";
  const centsFromFraction =
    fraction.length === 0 ? 0 : fraction.length === 1 ? Number(fraction) * 10 : Number(fraction);
  const cents = Number(whole) * 100 + centsFromFraction;

  return { cents, literal };
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
