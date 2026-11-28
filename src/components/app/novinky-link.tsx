"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { hasUnreadReleaseNotes, releaseNotesSeenKey } from "@/modules/release-notes";

/** Reads this browser's last seen note; blocked or junk storage reads as nothing seen. */
export function readSeenReleaseNote(email: string): string | null {
  try {
    return window.localStorage.getItem(releaseNotesSeenKey(email));
  } catch {
    return null;
  }
}

/**
 * *Novinky* in the app bar, with a dot until the newest note has been opened in
 * this browser. Unread is decided after mount, so the server's render and the
 * first client render agree (no dot), and a page with storage blocked shows one.
 */
export function NovinkyLink({ email, className }: { email: string; className: string }) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    setUnread(hasUnreadReleaseNotes(readSeenReleaseNote(email)));
  }, [email]);

  return (
    <Link
      href="/novinky"
      data-testid="nav-novinky"
      data-unread={unread ? "true" : "false"}
      aria-label={unread ? "Novinky (nové)" : "Novinky"}
      title="Novinky"
      className={`relative ${className}`}
    >
      <Megaphone aria-hidden className="size-[18px]" strokeWidth={1.8} />
      {unread ? (
        <span aria-hidden data-testid="nav-novinky-dot" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />
      ) : null}
    </Link>
  );
}
