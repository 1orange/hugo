"use client";

import { useEffect } from "react";
import { releaseNotesSeenKey } from "@/modules/release-notes";

/** Opening Novinky marks the newest note seen in this browser, which clears the app bar's dot. */
export function MarkReleaseNotesSeen({ email, latestId }: { email: string; latestId: string | null }) {
  useEffect(() => {
    if (!latestId) {
      return;
    }
    try {
      window.localStorage.setItem(releaseNotesSeenKey(email), latestId);
    } catch {
      // Blocked storage: the dot simply stays.
    }
  }, [email, latestId]);
  return null;
}
