import Link from "next/link";
import { signOut } from "@/lib/auth/config";
import { formatSweepAge } from "@/modules/format-sk";
import { RefreshButton } from "@/app/companies/refresh-button";

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

/**
 * One row of chrome, identical on every screen. Everything that used to be a
 * stacked panel — sweep freshness, refresh, settings — lives here so the work
 * starts at the top of the page instead of below four boxes.
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
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-3.5">
      <Link
        href="/companies"
        className="text-[15px] font-bold tracking-[-0.03em] text-ink"
      >
        hug<span className="text-accent">o</span>
      </Link>

      <nav
        aria-label="Navigácia"
        className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-3"
      >
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <span aria-hidden>/</span> : null}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className={`truncate hover:text-accent ${crumb.mono ? "font-mono" : ""}`}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={`truncate ${
                  index === crumbs.length - 1 ? "font-semibold text-ink" : ""
                } ${crumb.mono ? "font-mono font-normal text-ink-3" : ""}`}
              >
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      <span
        className="hidden text-[11.5px] text-ink-3 sm:inline"
        data-testid="last-sweep-at"
        data-sweep-at={lastSweepAt ?? ""}
      >
        {formatSweepAge(lastSweepAt)}
      </span>

      <RefreshButton />

      <Link
        href="/settings"
        className="rounded-md border border-line-2 bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 hover:border-accent hover:text-accent"
      >
        Nastavenia
      </Link>

      <span
        className="grid size-[22px] place-items-center rounded-full bg-accent-soft text-[10.5px] font-bold text-accent"
        title={email}
        aria-label={`Prihlásená ako ${email}`}
      >
        {initials(email)}
      </span>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-line-2 bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 hover:border-accent hover:text-accent"
        >
          Odhlásiť
        </button>
      </form>
    </header>
  );
}
