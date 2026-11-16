import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { countWithNoun } from "@/modules/format-sk";
import { listSubjectDirectory, DIRECTORY_PAGE_SIZE } from "@/lib/subject-directory/screen";
import { scheduleStaleOfficeClientChecks } from "@/lib/subject-directory/schedule";
import { DirectoryTable } from "./directory-table";

type AdresarPageProps = {
  searchParams: Promise<{ q?: string; klienti?: string }>;
};

const SUBJECT_FORMS = ["subjekt", "subjekty", "subjektov"] as const;

function countText(total: number, shown: number, query: string, clientsOnly: boolean): string {
  if (total === 0) {
    if (query) {
      return "Nič sa nenašlo.";
    }
    return clientsOnly ? "Zatiaľ nie je v adresári žiadny klient." : "Adresár je zatiaľ prázdny.";
  }
  const noun = countWithNoun(total, SUBJECT_FORMS);
  if (shown < total) {
    return `Zobrazených ${shown} z ${noun}. Upresnite hľadanie.`;
  }
  return `${noun}${query ? " zodpovedá hľadaniu" : ""}.`;
}

/** The list's address for a search and a scope; the scope's links keep the search. */
function listHref(query: string, clientsOnly: boolean): string {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (clientsOnly) {
    params.set("klienti", "1");
  }
  const search = params.toString();
  return search ? `/adresar?${search}` : "/adresar";
}

/** The office's subject directory (ADR 0022): searched on the server, so the list is what the search finds. */
export default async function AdresarPage({ searchParams }: AdresarPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { q, klienti } = await searchParams;
  const clientsOnly = klienti === "1";
  // Office clients have no company page to refresh them from, so the list does (0006/04).
  await scheduleStaleOfficeClientChecks();
  const directory = await listSubjectDirectory(q ?? "", DIRECTORY_PAGE_SIZE, { clientsOnly });
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[{ label: "Firmy", href: "/companies" }, { label: "Adresár" }]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Adresár</h1>
          <p className="text-[12.5px] text-ink-2">
            Firmy, s ktorými pracujú vaši klienti, overené v registroch. Hľadajte podľa názvu, bývalého názvu,
            názvu na dokladoch, IČO, DIČ alebo IČ DPH.
          </p>
        </header>

        <div role="group" aria-label="Zobrazenie subjektov" className="segmented" data-testid="directory-scope">
          <Link
            href={listHref(directory.query, false)}
            aria-pressed={!clientsOnly}
            data-testid="directory-scope-all"
            className="segment"
          >
            Všetky
          </Link>
          <Link
            href={listHref(directory.query, true)}
            aria-pressed={clientsOnly}
            data-testid="directory-scope-clients"
            className="segment"
          >
            Klienti
          </Link>
        </div>

        <form method="get" role="search" className="flex flex-wrap items-center gap-2">
          {clientsOnly ? <input type="hidden" name="klienti" value="1" /> : null}
          <input
            type="search"
            name="q"
            defaultValue={directory.query}
            placeholder="Názov, IČO, DIČ alebo IČ DPH"
            aria-label="Hľadať v adresári"
            data-testid="directory-search"
            className="min-w-[260px] flex-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <button
            type="submit"
            data-testid="directory-search-submit"
            className="rounded-md border border-line-2 bg-surface px-3 py-2 text-[12.5px] text-ink-2 hover:border-accent hover:text-accent"
          >
            Hľadať
          </button>
          {directory.query || clientsOnly ? (
            <Link href={listHref("", clientsOnly)} className="text-[12.5px] text-ink-3 hover:text-accent">
              Zrušiť hľadanie
            </Link>
          ) : null}
        </form>

        <p className="text-[12px] text-ink-3" data-testid="directory-count">
          {countText(directory.total, directory.rows.length, directory.query, clientsOnly)}
        </p>

        {directory.rows.length > 0 ? <DirectoryTable rows={directory.rows} /> : null}

      </main>
    </div>
  );
}
