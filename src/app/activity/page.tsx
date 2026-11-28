import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { buildGlobalActivityView } from "@/lib/activity-log/view";
import { visibleCompanies } from "@/lib/access/visibility";
import { ActivityLogPanel } from "@/app/companies/[companyId]/activity/activity-log-panel";

type GlobalActivityPageProps = {
  searchParams: Promise<{
    type?: string;
    before?: string;
  }>;
};

export default async function GlobalActivityPage({
  searchParams,
}: GlobalActivityPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const query = await searchParams;
  const beforeId = query.before ? Number(query.before) : undefined;
  const filters = query.type ? { eventType: query.type } : {};
  // Her companies' events and the office's own; another company's events are not read (ADR 0023).
  const visibility = await visibleCompanies(session.user.email);
  const view = await buildGlobalActivityView(
    [...visibility.ids],
    filters,
    Number.isInteger(beforeId) ? beforeId : undefined,
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          { label: "Nastavenia", href: "/settings" },
          { label: "Celý denník" },
        ]}
        email={session.user.email}
        lastSweepAt={(await getSettings()).lastSweepAt}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <header>
          <h1 className="text-2xl">Celý denník aktivity</h1>
          <p className="mt-1 text-sm text-ink-2">
            Zmeny firiem, ktoré vidíš, a zmeny úradu, ktoré nepatria ku konkrétnej firme.
          </p>
        </header>

        <div className="mt-6">
          <ActivityLogPanel view={view} basePath="/activity" />
        </div>
      </main>
    </div>
  );
}
