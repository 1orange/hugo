"use client";

import { useEffect, useState } from "react";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";
import { latestQueueView, subscribeServerEvents } from "./server-events";

/**
 * The extraction queue as the server pushes it (server-events module): no
 * polling, a new view whenever the queue moves. Stale while the connection is
 * down, until the reconnect brings a fresh one.
 */
export function useExtractionQueue(
  initial: ExtractionQueueView | null = null,
): { view: ExtractionQueueView | null; stale: boolean } {
  const [view, setView] = useState<ExtractionQueueView | null>(() => latestQueueView() ?? initial);
  const [stale, setStale] = useState(false);

  useEffect(
    () =>
      subscribeServerEvents((event) => {
        if (event.type === "queue") {
          setView(event.view);
          setStale(false);
        } else if (event.type === "disconnected") {
          setStale(true);
        }
      }),
    [],
  );

  return { view, stale };
}
