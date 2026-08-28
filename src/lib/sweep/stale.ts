export const SWEEP_STALE_AFTER_MS = 5 * 60 * 1000;

export function isSweepStale(
  lastSweepAt: string | null,
  nowMs: number,
): boolean {
  if (!lastSweepAt) {
    return true;
  }

  const lastMs = Date.parse(lastSweepAt);
  if (Number.isNaN(lastMs)) {
    return true;
  }

  return nowMs - lastMs >= SWEEP_STALE_AFTER_MS;
}
