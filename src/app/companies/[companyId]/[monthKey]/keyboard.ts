/**
 * Single-key shortcuts (C, N, J, K, X) act on the page only while she is not
 * typing: a key pressed in a field or text box is text, not a command.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}
