"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeServerEvents } from "./server-events";

/** A burst of reads or a sweep's worth of files renders once. */
const SETTLE_MS = 1000;

/**
 * Renders the page again when a document is read or files change in Drive,
 * anywhere: for screens that count across companies, such as the chase list.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [, startRefresh] = useTransition();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeServerEvents((event) => {
      if (event.type !== "document-read" && event.type !== "files-changed") {
        return;
      }
      timer ??= setTimeout(() => {
        timer = null;
        startRefresh(() => router.refresh());
      }, SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [router]);

  return null;
}
