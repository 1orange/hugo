import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { getOpenMonthKey } from "@/adapters/store/months";
import {
  loadCompanyProfileView,
  lookupCompanyRegister,
  searchCompanyRegister,
} from "@/lib/company-profile/service";
import type { CompanyCountry, RegisterSearchHit } from "@/modules/company-profile";
import { saveCompanyProfileFormAction } from "./actions";
import { CompanyProfileForm } from "./company-profile-form";

type CompanyProfilePageProps = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ ico?: string; saved?: string; error?: string; country?: string }>;
};

export default async function CompanyProfilePage({
  params,
  searchParams,
}: CompanyProfilePageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { companyId: companyIdRaw } = await params;
  const { ico: pickIco, saved, error: saveError, country: countryParam } = await searchParams;
  const companyId = Number.parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    notFound();
  }

  const view = loadCompanyProfileView(companyId);
  if (!view) {
    notFound();
  }

  const settings = getSettings();
  const openMonth = getOpenMonthKey(companyId);
  let initialCandidates: RegisterSearchHit[] = [];
  let registerLookupError: string | null = null;
  let pickedFromRegister: {
    legalName: string;
    address: string;
    ico: string;
    dic: string;
    registerSource: string;
  } | null = null;

  const setupCountry: CompanyCountry =
    view.profile?.country ??
    (countryParam === "CZ" ? "CZ" : "SK");

  if (view.profile === null) {
    const search = await searchCompanyRegister(companyId, view.companyName, setupCountry);
    if (search.ok) {
      initialCandidates = search.hits;
    }
    if (pickIco) {
      const lookup = await lookupCompanyRegister(pickIco, setupCountry);
      if (lookup.ok) {
        pickedFromRegister = {
          legalName: lookup.lookup.legalName,
          address: lookup.lookup.address,
          ico: lookup.lookup.ico,
          dic: lookup.lookup.dic,
          registerSource: lookup.registerSource,
        };
      } else {
        registerLookupError = lookup.message;
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          { label: view.companyName },
          { label: "Profil firmy" },
        ]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
          {openMonth ? (
            <Link
              href={`/companies/${companyId}/${openMonth}`}
              className="text-accent underline"
            >
              Späť na mesiac {openMonth}
            </Link>
          ) : (
            <Link href="/companies" className="text-accent underline">
              Späť na zoznam firiem
            </Link>
          )}
        </div>

        <h1 className="text-lg font-semibold">Profil firmy — {view.companyName}</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Identita klienta pre odvodenie dodávateľa a odberateľa na faktúrach. Nastaví sa raz,
          potom sa dá upraviť.
        </p>

        <div className="mt-6">
          <CompanyProfileForm
            key={`${pickIco ?? "new"}-${setupCountry}-${saved ?? ""}`}
            companyId={companyId}
            folderName={view.companyName}
            initialCountry={setupCountry}
            initialProfile={view.profile}
            initialCandidates={initialCandidates}
            pickedFromRegister={pickedFromRegister}
            registerLookupError={registerLookupError}
            saveFormAction={saveCompanyProfileFormAction.bind(null, companyId)}
            savedFlash={saved === "1"}
            saveErrorFlash={saveError ? decodeURIComponent(saveError) : null}
          />
        </div>
      </main>
    </div>
  );
}
