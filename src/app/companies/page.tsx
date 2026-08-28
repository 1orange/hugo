import { Building2 } from "lucide-react";
import Link from "next/link";
import { listCompanies } from "@/adapters/store/companies";
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

export default async function CompaniesPage() {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const companies = listCompanies();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.user.email}
          </p>
        </div>
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
      </header>

      {companies.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" aria-hidden />
              No companies yet
            </CardTitle>
            <CardDescription>
              Companies will appear here once Drive synchronisation is
              configured. This walking skeleton confirms authentication and
              database access are working.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Next slice: connect the service account and sweep company folders
              from Drive.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                className="block rounded-lg border border-border p-4 hover:bg-muted"
                href={`/companies/${company.id}`}
              >
                {company.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
