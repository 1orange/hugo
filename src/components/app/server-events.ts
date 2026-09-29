"use client";

import type { AppEvent } from "@/lib/events/bus";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";

/**
 * The tab's one connection to /api/events (ADR 0021), shared by every
 * component that listens: the app bar, the queue page, the month screen. It
 * opens with the first listener and closes with the last.
 */
export type ServerEvent =
  | { type: "queue"; view: ExtractionQueueView }
  | Extract<AppEvent, { type: "document-read" | "files-changed" }>
  /** The connection is down; the browser is reconnecting. */
  | { type: "disconnected" };

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let latestQueue: ExtractionQueueView | null = null;

function emit(event: ServerEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

function connect(): void {
  source = new EventSource("/api/events");
  source.addEventListener("queue", (message) => {
    latestQueue = JSON.parse((message as MessageEvent<string>).data) as ExtractionQueueView;
    emit({ type: "queue", view: latestQueue });
  });
  for (const type of ["document-read", "files-changed"] as const) {
    source.addEventListener(type, (message) => {
      emit(JSON.parse((message as MessageEvent<string>).data) as ServerEvent);
    });
  }
  source.addEventListener("error", () => emit({ type: "disconnected" }));
}

export function subscribeServerEvents(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    connect();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

/** The last queue the server sent, for a component mounting after it arrived. */
export function latestQueueView(): ExtractionQueueView | null {
  return latestQueue;
}
