import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { loadExtractionQueueView } from "@/lib/extraction-queue/view";
import { QueuePanel } from "./queue-panel";

export const dynamic = "force-dynamic";

type QueuePageProps = {
  searchParams: Promise<{ from?: string }>;
};

/**
 * Where "Späť" goes: the page she came from, if it is one of this app's.
 * "//host" and "/\host" are other sites to a browser.
 */
function backHref(from: string | undefined): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.includes("\\") || from.startsWith("/queue")) {
    return null;
  }
  return from;
}

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const view = await loadExtractionQueueView();
  const back = backHref((await searchParams).from);

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <AppBar
        crumbs={[{ label: "Firmy", href: "/companies" }, { label: "Spracovanie" }]}
        email={session.user.email}
        lastSweepAt={(await getSettings()).lastSweepAt}
      />

      <main className="mx-auto w-full max-w-[820px] flex-1 px-4 pt-6 pb-16 sm:px-6">
        <Link href={back ?? "/companies"} className="text-[13.5px] font-medium text-accent hover:underline" data-testid="queue-back">
          {back ? "‹ Späť" : "‹ Späť na zoznam firiem"}
        </Link>

        <header className="mt-2.5">
          <h1 className="title-large">Spracovanie dokladov</h1>
          <p className="mt-1.5 text-[15px] text-ink-3">
            Jeden rad pre všetky firmy: čo sa práve číta, čo čaká a ako dopadli posledné doklady.
          </p>
        </header>

        <div className="mt-6">
          <QueuePanel initial={view} />
        </div>
      </main>
    </div>
  );
}
