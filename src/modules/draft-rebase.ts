/**
 * Carries her unsaved edits across a refresh of the same document.
 *
 * The workbench refreshes while anything is being extracted, and each refresh
 * used to replace the fields panel's draft outright: a field she was typing
 * but had not yet left was silently lost when a background extraction
 * finished. Per field: one she has changed since the last saved snapshot
 * keeps her value; every other field takes the refreshed value.
 */
export function rebaseDraft<T extends Record<string, unknown>>(input: {
  /** What the panel last loaded or saved. */
  saved: T;
  /** What the panel shows now, her unsaved edits included. */
  draft: T;
  /** The refreshed document. */
  incoming: T;
}): T {
  const merged = { ...input.incoming };
  for (const key of Object.keys(input.draft) as Array<keyof T>) {
    if (!sameValue(input.draft[key], input.saved[key])) {
      merged[key] = input.draft[key];
    }
  }
  return merged;
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
