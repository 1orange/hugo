"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeServerEvents } from "@/components/app/server-events";
import type { DocumentListItem } from "@/lib/documents/view";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";
import {
  liveExtractionByFile,
  refreshReason,
  servicesReady,
  type LiveExtraction,
} from "@/modules/month-extraction-watch";

/** An "idle" re-render (the queue holds none of them) at most this often… */
const IDLE_REFRESH_MS = 10_000;
/** …and this many times in a row, until the pending documents change. */
const IDLE_REFRESH_LIMIT = 3;

/**
 * The month screen, kept current by what the server pushes (ADR 0021): it
 * renders again when one of its documents is read, when files in its month
 * change in Drive, and — from the queue snapshot every reconnect brings —
 * when it missed either while the connection was down. Between those, each
 * pending document shows how far it is.
 */
export function useMonthExtraction({
  companyId,
  monthKey,
  documents,
}: {
  companyId: number;
  monthKey: string;
  documents: DocumentListItem[];
}): Map<string, LiveExtraction> {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [queue, setQueue] = useState<ExtractionQueueView | null>(null);
  const pendingFileIds = useMemo(
    () => [
      ...new Set(
        documents
          .filter((document) => document.derivedStatus.kind === "pending-extraction")
          .map((document) => document.driveFileId),
      ),
    ],
    [documents],
  );
  const pendingKey = pendingFileIds.join(",");
  // The listener outlives renders; it reads the current values from here.
  const current = useRef({ pendingFileIds, companyId, monthKey });
  current.current = { pendingFileIds, companyId, monthKey };
  const wereServicesReady = useRef<boolean | null>(null);
  const idle = useRef({ count: 0, at: 0 });

  useEffect(() => {
    idle.current.count = 0;
  }, [pendingKey]);

  useEffect(() => {
    const refresh = () => startRefresh(() => router.refresh());
    return subscribeServerEvents((event) => {
      const here = current.current;
      if (event.type === "document-read") {
        if (event.companyId === here.companyId && event.monthKey === here.monthKey) {
          refresh();
        }
        return;
      }
      if (event.type === "files-changed") {
        if (event.months.some((month) => month.companyId === here.companyId && month.monthKey === here.monthKey)) {
          refresh();
        }
        return;
      }
      if (event.type !== "queue") {
        return;
      }
      setQueue(event.view);
      const reason = refreshReason({
        queue: event.view,
        companyId: here.companyId,
        monthKey: here.monthKey,
        pendingFileIds: here.pendingFileIds,
        wereServicesReady: wereServicesReady.current,
      });
      wereServicesReady.current = servicesReady(event.view);
      if (reason === "idle") {
        const now = Date.now();
        if (idle.current.count >= IDLE_REFRESH_LIMIT || now - idle.current.at < IDLE_REFRESH_MS) {
          return;
        }
        idle.current = { count: idle.current.count + 1, at: now };
      }
      if (reason) {
        refresh();
      }
    });
  }, [router]);

  return useMemo(
    () => (queue && pendingFileIds.length > 0 ? liveExtractionByFile(queue, companyId, monthKey) : new Map()),
    [queue, pendingFileIds.length, companyId, monthKey],
  );
}
