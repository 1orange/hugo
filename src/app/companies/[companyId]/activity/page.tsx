import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { buildCompanyActivityView } from "@/lib/activity-log/view";
import { getOpenMonthKey } from "@/adapters/store/months";
import { ActivityLogPanel } from "./activity-log-panel";

type CompanyActivityPageProps = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    type?: string;
    month?: string;
    before?: string;
  }>;
};

function parseFilters(searchParams: {
  type?: string;
  month?: string;
}): {
  eventType?: string;
  monthKey?: string | null;
} {
  const filters: {
    eventType?: string;
    monthKey?: string | null;
  } = {};
  if (searchParams.type) {
    filters.eventType = searchParams.type;
  }
  if (searchParams.month === "__none__") {
    filters.monthKey = null;
  } else if (searchParams.month) {
    filters.monthKey = searchParams.month;
  }
  return filters;
}

export default async function CompanyActivityPage({
  params,
  searchParams,
}: CompanyActivityPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { companyId } = await params;
  const companyIdNum = Number(companyId);
  if (!Number.isInteger(companyIdNum)) {
    notFound();
  }

  const query = await searchParams;
  const beforeId = query.before ? Number(query.before) : undefined;
  const filters = parseFilters(query);
  const view = await buildCompanyActivityView(
    companyIdNum,
    filters,
    Number.isInteger(beforeId) ? beforeId : undefined,
  );
  if (!view) {
    notFound();
  }

  const openMonth = await getOpenMonthKey(companyIdNum);
  const basePath = `/companies/${companyId}/activity`;
  const companyName = view.companyName ?? "Firma";

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          openMonth
            ? {
                label: companyName,
                href: `/companies/${companyId}/${openMonth}`,
              }
            : { label: companyName },
          { label: "Denník aktivity" },
        ]}
        email={session.user.email}
        lastSweepAt={(await getSettings()).lastSweepAt}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <header>
          <h1 className="text-2xl">Denník aktivity</h1>
          <p className="mt-1 text-sm text-ink-2">
            Všetko, čo aplikácia a ty ste urobili pre firmu {companyName}.
          </p>
        </header>

        <div className="mt-6">
          <ActivityLogPanel view={view} basePath={basePath} />
        </div>
      </main>
    </div>
  );
}
