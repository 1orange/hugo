import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { countWithNoun } from "@/modules/format-sk";
import { listSubjectDirectory, DIRECTORY_PAGE_SIZE, type DirectoryListRow } from "@/lib/subject-directory/screen";

type AdresarPageProps = {
  searchParams: Promise<{ q?: string }>;
};

const TONE_CLASSES: Record<DirectoryListRow["verdictTone"], string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-ink-2",
};

const SUBJECT_FORMS = ["subjekt", "subjekty", "subjektov"] as const;

function countText(total: number, shown: number, query: string): string {
  if (total === 0) {
    return query ? "Nič sa nenašlo." : "Adresár je zatiaľ prázdny.";
  }
  const noun = countWithNoun(total, SUBJECT_FORMS);
  if (shown < total) {
    return `Zobrazených ${shown} z ${noun}. Upresnite hľadanie.`;
  }
  return `${noun}${query ? " zodpovedá hľadaniu" : ""}.`;
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

  const { q } = await searchParams;
  const directory = await listSubjectDirectory(q ?? "", DIRECTORY_PAGE_SIZE);
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

        <form method="get" role="search" className="flex flex-wrap items-center gap-2">
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
          {directory.query ? (
            <Link href="/adresar" className="text-[12.5px] text-ink-3 hover:text-accent">
              Zrušiť hľadanie
            </Link>
          ) : null}
        </form>

        <p className="text-[12px] text-ink-3" data-testid="directory-count">
          {countText(directory.total, directory.rows.length, directory.query)}
        </p>

        {directory.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
              <thead className="bg-surface-2 text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-semibold">Názov</th>
                  <th className="px-3 py-2 font-semibold">Krajina</th>
                  <th className="px-3 py-2 font-semibold">IČO</th>
                  <th className="px-3 py-2 font-semibold">DIČ</th>
                  <th className="px-3 py-2 font-semibold">IČ DPH</th>
                  <th className="px-3 py-2 font-semibold">Stav</th>
                  <th className="px-3 py-2 font-semibold">Naposledy videný</th>
                </tr>
              </thead>
              <tbody>
                {directory.rows.map((row) => (
                  <tr key={row.id} data-testid={`directory-row-${row.id}`} className="border-t border-line hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <Link
                        href={`/adresar/${row.id}`}
                        data-testid={`directory-link-${row.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.country}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.ico ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.dic ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.icDph ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        data-testid={`directory-verdict-${row.id}`}
                        className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium ${TONE_CLASSES[row.verdictTone]}`}
                      >
                        {row.verdictLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-3">{row.lastSeenLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

      </main>
    </div>
  );
}
