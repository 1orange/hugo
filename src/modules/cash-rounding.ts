/**
 * Cash totals are rounded by law, and the rounding is not part of any VAT base:
 * the items and the per-rate VAT stay as printed, and the payable total differs
 * from them by the rounding alone.
 *
 * - EUR, Slovakia since 1 July 2022: the final cash amount to the nearest 5 cents.
 * - CZK, Czech Republic since the haléř coins were withdrawn in 2008: to the
 *   nearest whole koruna, half up.
 *
 * The rule follows the currency the receipt was paid in — the shop's country —
 * not the buyer's: a Czech company's cash receipt from Bratislava is in EUR and
 * rounded the Slovak way. Card payments are not rounded, which is why an exact
 * total is always accepted as well.
 */
const CASH_ROUNDING_STEP_CENTS: Record<string, number> = {
  EUR: 5,
  CZK: 100,
};

function stepFor(currency: string): number | null {
  return CASH_ROUNDING_STEP_CENTS[currency.trim().toUpperCase()] ?? null;
}

export function roundCashTotalCents(cents: number, currency: string): number | null {
  const step = stepFor(currency);
  if (step === null) {
    return null;
  }
  // Half up, symmetric for refunds. At a 5-cent step no halves exist in cents.
  const rounded = Math.round(Math.abs(cents) / step) * step;
  return cents < 0 ? -rounded : rounded;
}

/**
 * The rounding a cash payment added to `itemsTotalCents` to reach
 * `payableCents`: 0 when they are equal, the difference when it is exactly the
 * legal cash rounding, and null when it is anything else.
 */
export function cashRoundingCents(input: {
  itemsTotalCents: number;
  payableCents: number;
  currency: string;
}): number | null {
  if (input.itemsTotalCents === input.payableCents) {
    return 0;
  }
  const rounded = roundCashTotalCents(input.itemsTotalCents, input.currency);
  if (rounded === null || rounded !== input.payableCents) {
    return null;
  }
  return input.payableCents - input.itemsTotalCents;
}
