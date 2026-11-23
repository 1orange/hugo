import { bookingMonthKey, isMonthKey } from "./month-lifecycle";

/**
 * The `?month=` value that asks *Firmy* for each company's own open month
 * (*Otvorené mesiace*). It has a URL of its own so the daily chase view can be
 * bookmarked and reached from the picker, while the bare page opens the
 * booking month.
 */
export const OPEN_MONTHS_PARAM = "open";

/**
 * Which month *Firmy* shows, as a `YYYY_MM` key, or `null` for each company's
 * own open month.
 *
 * - No value, or a value that is not a month key or `open`: the booking month.
 *   The office books last month, so the home screen starts there.
 * - `open`: `null`, each company's open month.
 * - The booking month, or a month some company has: that month. A company
 *   without it gets the *Tento mesiac tu nie je* row, as a picked month always did.
 * - A valid month key that no company has and that is not the booking month:
 *   `null`, as before this change. Pages built from old links keep the open-month view.
 *
 * The booking month is never subject to the last rule, because the bare page
 * must show it even when no company has a folder for it yet.
 */
export function resolveCompaniesMonth(
  requested: string | undefined,
  knownMonthKeys: readonly string[],
  instant: Date,
): string | null {
  const booking = bookingMonthKey(instant);

  if (requested === OPEN_MONTHS_PARAM) {
    return null;
  }
  if (requested === undefined || !isMonthKey(requested)) {
    return booking;
  }
  if (requested === booking || knownMonthKeys.includes(requested)) {
    return requested;
  }
  return null;
}
