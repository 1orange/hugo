import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { loadSettingsFormData } from "@/lib/settings/service";
import { ClientSheetImport } from "./client-sheet-import";
import { applyClientSheetAction, previewClientSheetAction } from "./actions";

export default async function ClientSheetPage() {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const settings = await loadSettingsFormData();

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          { label: "Nastavenia", href: "/settings" },
          { label: "Klienti" },
        ]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-6 pb-24 sm:px-6">
        <Link href="/settings" className="text-[13.5px] font-medium text-accent hover:underline">
          ‹ Späť na nastavenia
        </Link>
        <header className="mt-2.5 mb-7">
          <h1 className="title-large">Klienti z hárku</h1>
          <p className="mt-1.5 text-[15px] text-ink-3">
            Nahraj tabuľku Klienti ako CSV. Najprv uvidíš náhľad; firmy a klienti do Adresára sa zapíšu až po potvrdení.
          </p>
        </header>

        <ClientSheetImport previewAction={previewClientSheetAction} applyAction={applyClientSheetAction} />
      </main>
    </div>
  );
}
