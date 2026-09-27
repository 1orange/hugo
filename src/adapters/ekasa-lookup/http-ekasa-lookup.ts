import type { EkasaLookup, EkasaLookupResult } from "./port";

export const EKASA_OPD_FIND_URL =
  "https://ekasa.financnasprava.sk/mdu/api/v1/opd/receipt/find";

export const EKASA_LOOKUP_USER_AGENT = "hugo-accounting/0.1";

type FetchLike = typeof fetch;

/**
 * ponytail: one in-flight OPD request globally; enough at a few dozen receipts
 * per month. Upgrade: per-process queue with concurrency if volume grows.
 */
let requestChain: Promise<void> = Promise.resolve();

function enqueueLookup<T>(work: () => Promise<T>): Promise<T> {
  const run = requestChain.then(work, work);
  requestChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function createHttpEkasaLookup(
  fetchImpl: FetchLike = fetch,
): EkasaLookup {
  return {
    findReceipt(receiptId: string): Promise<EkasaLookupResult> {
      return enqueueLookup(async () => {
        try {
          const response = await fetchImpl(EKASA_OPD_FIND_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": EKASA_LOOKUP_USER_AGENT,
            },
            body: JSON.stringify({ receiptId }),
          });

          if (response.status === 499) {
            return {
              ok: false,
              reason: "Finančná správa refused the request (HTTP 499).",
            };
          }

          if (response.status === 404) {
            return { ok: false, reason: "Receipt not found in eKasa." };
          }

          if (!response.ok) {
            return {
              ok: false,
              reason: `eKasa lookup failed with HTTP ${response.status}.`,
            };
          }

          const raw: unknown = await response.json();
          const envelope = raw as { returnValue?: number; receipt?: unknown };
          if (envelope.returnValue !== 0 || !envelope.receipt) {
            return { ok: false, reason: "Receipt not found in eKasa." };
          }

          return { ok: true, raw };
        } catch {
          return {
            ok: false,
            reason: "eKasa lookup is unreachable.",
          };
        }
      });
    },
  };
}
