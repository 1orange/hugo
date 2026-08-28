import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
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
  const view = buildCompanyActivityView(
    companyIdNum,
    filters,
    Number.isInteger(beforeId) ? beforeId : undefined,
  );
  if (!view) {
    notFound();
  }

  const openMonth = getOpenMonthKey(companyIdNum);
  const basePath = `/companies/${companyId}/activity`;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link className="underline" href="/companies">
            Companies
          </Link>
          {" · "}
          {openMonth ? (
            <Link className="underline" href={`/companies/${companyId}/${openMonth}`}>
              {view.companyName}
            </Link>
          ) : (
            <span>{view.companyName}</span>
          )}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          Everything the app and you did for {view.companyName}.
        </p>
      </header>

      <ActivityLogPanel view={view} basePath={basePath} />
    </main>
  );
}
