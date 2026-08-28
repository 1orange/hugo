import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { buildGlobalActivityView } from "@/lib/activity-log/view";
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
  const view = buildGlobalActivityView(
    filters,
    Number.isInteger(beforeId) ? beforeId : undefined,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href="/companies">
              Companies
            </Link>
            {" · "}
            <Link className="underline" href="/settings">
              Settings
            </Link>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">All activity</h1>
          <p className="text-sm text-muted-foreground">
            Global changes that are not tied to one company.
          </p>
        </div>
      </header>

      <ActivityLogPanel view={view} basePath="/activity" />
    </main>
  );
}
