import Link from "next/link";
import { BookUser, ChevronRight, LogOut, Settings } from "lucide-react";
import { signOut } from "@/lib/auth/config";
import { formatSweepAge } from "@/modules/format-sk";
import { RefreshButton } from "@/app/companies/refresh-button";
import { NovinkyLink } from "./novinky-link";
import { QueueIndicator } from "./queue-indicator";

export type Crumb = {
  label: string;
  href?: string;
  mono?: boolean;
};

function initials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || local.slice(0, 2)).toUpperCase();
}

const ICON_BUTTON =
  "press grid size-[34px] place-items-center rounded-lg text-ink-2 hover:bg-fill hover:text-ink";

/**
 * One row of translucent chrome, identical on every screen: where she is, the
 * reading queue, how fresh Drive is, and the few places she can go. Pages put
 * their own controls in a toolbar below it.
 */
export function AppBar({
  crumbs,
  email,
  lastSweepAt,
}: {
  crumbs: Crumb[];
  email: string;
  lastSweepAt: string | null;
}) {
  return (
    <header className="glass sticky top-0 z-30 flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 shadow-[0_1px_0_rgb(0_0_0/0.07)] sm:px-6">
      <Link href="/companies" className="text-[17px] font-bold tracking-[-0.03em] text-ink">
        hug<span className="text-accent">o</span>
      </Link>

      <nav aria-label="Navigácia" className="flex min-w-0 items-center gap-1 text-[13.5px] text-ink-3">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-4" /> : null}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className={`truncate rounded-md px-1 hover:text-accent ${crumb.mono ? "font-mono text-[12.5px]" : ""}`}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
                className={`truncate px-1 ${index === crumbs.length - 1 ? "font-semibold text-ink" : ""} ${
                  crumb.mono ? "font-mono text-[12.5px] font-normal text-ink-3" : ""
                }`}
              >
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      <QueueIndicator />

      <span
        className="hidden items-center gap-2 text-[12.5px] text-ink-3 md:inline-flex"
        data-testid="last-sweep-at"
        data-sweep-at={lastSweepAt ?? ""}
      >
        <span aria-hidden className="size-[7px] rounded-full bg-good-dot" />
        {formatSweepAge(lastSweepAt)}
      </span>

      <div className="flex items-center gap-0.5">
        <RefreshButton />

        <NovinkyLink email={email} className={ICON_BUTTON} />

        <Link href="/adresar" data-testid="nav-adresar" aria-label="Adresár" title="Adresár" className={ICON_BUTTON}>
          <BookUser aria-hidden className="size-[18px]" strokeWidth={1.8} />
        </Link>

        <Link href="/settings" aria-label="Nastavenia" title="Nastavenia" className={ICON_BUTTON}>
          <Settings aria-hidden className="size-[18px]" strokeWidth={1.8} />
        </Link>

        <details className="relative">
          <summary
            className="press grid size-[34px] cursor-pointer list-none place-items-center rounded-full [&::-webkit-details-marker]:hidden"
            aria-label={`Účet: ${email}`}
            title={email}
          >
            <span className="grid size-[28px] place-items-center rounded-full bg-surface-3 text-[11.5px] font-semibold text-ink-2">
              {initials(email)}
            </span>
          </summary>
          <div className="glass-strong pop-in absolute top-11 right-0 z-40 w-64 origin-top-right rounded-xl p-1.5 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.16)]">
            <p className="truncate px-2.5 pt-1.5 pb-2 text-[12.5px] text-ink-3">
              Prihlásená ako <span className="text-ink">{email}</span>
            </p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/sign-in" });
              }}
            >
              <button
                type="submit"
                className="press flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-fill"
              >
                <LogOut aria-hidden className="size-4 text-ink-3" />
                Odhlásiť
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
