import { Building2 } from "lucide-react";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ensureFreshSweep } from "@/lib/sweep/ensure-fresh-sweep";
import { listCompanySummaries } from "@/lib/sweep/views";
import { getSettings } from "@/adapters/store/settings";
import { RefreshButton } from "./refresh-button";

function formatStage(stage: string): string {
  return stage;
}

function formatUnticked(count: number | null): string {
  if (count === null) {
    return "— unticked";
  }
  return `${count} unticked`;
}

export default async function CompaniesPage() {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  await ensureFreshSweep();
  const companies = listCompanySummaries();
  const settings = getSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.user.email}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <RefreshButton lastSweepAt={settings.lastSweepAt} />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {companies.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" aria-hidden />
              No companies yet
            </CardTitle>
            <CardDescription>
              Configure Drive access and run a sweep to discover client folders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Set DRIVE_PARENT_FOLDER_ID and service-account credentials, then
              press Refresh.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                className="block rounded-lg border border-border p-4 hover:bg-muted"
                href={
                  company.openMonth
                    ? `/companies/${company.id}/${company.openMonth}`
                    : `/companies/${company.id}`
                }
                data-testid={`company-${company.id}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">{company.name}</span>
                <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground">
                  <span data-testid={`company-stage-${company.id}`}>
                    {formatStage(company.stage)} · {formatUnticked(company.untickedCount)}
                  </span>
                  <span>
                    {company.openMonth
                      ? `Open month: ${company.openMonth}`
                      : "No open month"}
                  </span>
                </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
