/** Short: the worker asks at start-up and must not be held up by a server that does not answer. */
export const PROPS_TIMEOUT_MS = 1500;

export type ModelSlotsAnswer = { slots: number } | { slots: null; reason: string };

/**
 * The llama.cpp root for an OpenAI-style base URL: `…:8080/v1` → `…:8080`.
 * `/props` lives at the root, not under `/v1`.
 */
export function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return `neodpovedá do ${timeoutMs / 1000} s`;
    }
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? error.message;
  }
  return String(error);
}

/**
 * How many documents the model server runs at once: llama.cpp's `total_slots`,
 * which is its `-np`. Anything else — a 404 from Ollama, a 503 while the model
 * loads, a body without the field, no answer in time — is a reason, not a number:
 * the caller falls back and asks again later.
 */
export async function askModelSlots(
  extractorUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ModelSlotsAnswer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROPS_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchImpl(`${serverRoot(extractorUrl)}/props`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    return { slots: null, reason: describeError(error, timeoutMs) };
  }
  if (!response.ok) {
    return { slots: null, reason: `HTTP ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { slots: null, reason: describeError(error, timeoutMs) };
  }
  const slots = typeof body === "object" && body !== null ? (body as { total_slots?: unknown }).total_slots : undefined;
  if (typeof slots !== "number" || !Number.isInteger(slots) || slots < 1) {
    return { slots: null, reason: "/props nemá total_slots" };
  }
  return { slots };
}
