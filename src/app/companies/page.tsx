import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { LiveRefresh } from "@/components/app/live-refresh";
import { refreshAfterRender } from "@/lib/sweep/ensure-fresh-sweep";
import { listAllMonthKeys, listCompanySummaries } from "@/lib/sweep/views";
import { getSettings } from "@/adapters/store/settings";
import { ChaseMonthPicker } from "./chase-month-picker";
import { CompanyTable } from "./company-table";

type CompaniesPageProps = {
  searchParams: Promise<{ month?: string }>;
};

/**
 * Server work only. The *Moje firmy* filter is per-browser and applied in
 * `CompanyTable`, so nothing here depends on which companies are shown.
 */
export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { month } = await searchParams;
  const monthKeys = await listAllMonthKeys();
  const selectedMonth = month && monthKeys.includes(month) ? month : null;

  const companies = await listCompanySummaries(selectedMonth);
  const settings = await getSettings();

  // After the page is sent, never before it: a sweep if the last one is stale,
  // and the open months' unread documents queued, so by the time she clicks
  // into a client its receipts are usually read. The page reads only the
  // database; LiveRefresh renders it again when the sweep finds a change.
  after(() => refreshAfterRender());

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <LiveRefresh />
      <AppBar
        crumbs={
          selectedMonth
            ? [{ label: "Firmy", href: "/companies" }, { label: selectedMonth, mono: true }]
            : [{ label: "Firmy" }]
        }
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      {companies.length === 0 ? (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="inset-group max-w-md p-6">
            <h1 className="text-[20px] font-bold">Zatiaľ žiadne firmy</h1>
            <p className="mt-2 text-sm text-ink-2">
              Nastav prístup k Drive a spusti načítanie, aby sa priečinky klientov
              našli.
            </p>
            <p className="mt-3 text-sm text-ink-3">
              Vyplň nadradený priečinok Drive v{" "}
              <Link className="text-accent underline" href="/settings">
                Nastaveniach
              </Link>{" "}
              a stlač Obnoviť.
            </p>
          </div>
        </main>
      ) : (
        <CompanyTable
          rows={companies}
          email={session.user.email}
          selectedMonth={selectedMonth}
          monthControl={<ChaseMonthPicker monthKeys={monthKeys} selected={selectedMonth} />}
        />
      )}
    </div>
  );
}
