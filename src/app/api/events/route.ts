import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { subscribeAppEvents } from "@/lib/events/bus";
import { loadExtractionQueueView } from "@/lib/extraction-queue/view";
import { restrictEventToCompanies, visibleCompanies } from "@/lib/access/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Many queue changes a second while the model writes; the screens get one snapshot per this. */
const QUEUE_DEBOUNCE_MS = 250;
/** Proxies close a silent connection; a comment line keeps it open. */
const KEEP_ALIVE_MS = 20_000;

/**
 * What the screens hear, as server-sent events (ADR 0021): `queue` — the whole
 * extraction queue, first on connecting and again whenever it moves;
 * `document-read` and `files-changed` as they happen, from any worker or
 * replica. One tab, one connection; the browser reconnects by itself, and the
 * first `queue` after it tells the screen what it missed.
 *
 * Only what the signed-in person may see is sent (ADR 0023). Their visible
 * companies are re-read with each queue snapshot and on each keep-alive, so a
 * revoked share stops arriving within the keep-alive interval.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email || !isEmailAllowed(session.user.email, loadAllowlistFromEnv())) {
    return new Response(null, { status: 401 });
  }
  const email = session.user.email;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      // Empty until the first read: nothing is sent before the companies are known (fail closed).
      let visible: ReadonlySet<number> = new Set();

      const write = (text: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const refreshVisible = () =>
        visibleCompanies(email).then(
          (companies) => {
            visible = companies.ids;
          },
          (error: unknown) => {
            console.warn("[events] could not read the visible companies", error);
            visible = new Set();
          },
        );
      // The queue is built for this person's companies, so nothing of another company is read into it.
      const sendQueue = () => {
        refreshVisible()
          .then(() => loadExtractionQueueView(visible))
          .then(
            (view) => send("queue", view),
            (error: unknown) => console.warn("[events] could not load the queue", error),
          );
      };

      const unsubscribe = subscribeAppEvents((event) => {
        if (event.type === "queue-changed" || event.type === "services-changed") {
          debounce ??= setTimeout(() => {
            debounce = null;
            sendQueue();
          }, QUEUE_DEBOUNCE_MS);
          return;
        }
        const own = restrictEventToCompanies(event, visible);
        if (own) {
          send(own.type, own);
        }
      });
      const keepAlive = setInterval(() => {
        write(": keep-alive\n\n");
        void refreshVisible();
      }, KEEP_ALIVE_MS);

      cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe();
        clearInterval(keepAlive);
        if (debounce) {
          clearTimeout(debounce);
        }
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());

      write("retry: 3000\n\n");
      sendQueue();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: a compressing proxy would hold events back to fill a block.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
