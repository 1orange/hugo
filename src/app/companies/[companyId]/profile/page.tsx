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
} from "@/lib/company-profile/service";
import { loadProfileIdentity } from "@/lib/subject-directory/screen";
import { scheduleStaleClientSubjectCheck } from "@/lib/subject-directory/schedule";
import type { CompanyCountry } from "@/modules/company-profile";
import { restoreRegisterValueAction } from "@/app/adresar/actions";
import { IdentityStateList } from "@/components/identity/identity-states";
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

  const view = await loadCompanyProfileView(companyId);
  if (!view) {
    notFound();
  }
  // The register answer is refreshed here when it is stale; the page does not wait for it.
  await scheduleStaleClientSubjectCheck(companyId);
  const identity = await loadProfileIdentity(companyId);

  const settings = await getSettings();
  const openMonth = await getOpenMonthKey(companyId);
  let registerLookupError: string | null = null;
  let pickedFromRegister: {
    legalName: string;
    address: string;
    ico: string;
    dic: string;
    icDph: string | null;
    icDphNote: string | null;
    registerSource: string;
  } | null = null;

  const setupCountry: CompanyCountry =
    view.profile?.country ??
    (countryParam === "CZ" ? "CZ" : "SK");

  // The folder-name search runs in the form once the page is up: RPO takes
  // 6–7 s, and the page waited for it.
  if (view.profile === null) {
    if (pickIco) {
      const lookup = await lookupCompanyRegister(pickIco, setupCountry);
      if (lookup.ok) {
        pickedFromRegister = {
          legalName: lookup.lookup.legalName,
          address: lookup.lookup.address,
          ico: lookup.lookup.ico,
          dic: lookup.lookup.dic,
          icDph: lookup.icDph,
          icDphNote: lookup.icDphNote,
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

        {identity ? (
          <section aria-label="Overenie údajov" className="mt-6 flex flex-col gap-3" data-testid="profile-identity">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Overenie údajov</h2>
              <Link
                href={`/adresar/${identity.subjectId}`}
                data-testid="profile-adresar-link"
                className="text-[13px] text-accent underline"
              >
                Zobraziť v Adresári
              </Link>
            </div>
            <p className="text-[12.5px] text-ink-2" data-testid="profile-register-status">
              Stav v registri: {identity.registerStatusLabel} · overené: {identity.verifiedAtLabel}
            </p>
            {identity.vies.length > 0 ? (
              <ul className="text-[12.5px] text-ink-2" data-testid="profile-vies">
                {identity.vies.map((vies) => (
                  <li key={vies.vatId}>
                    VIES {vies.vatId}: {vies.label} (overené {vies.checkedLabel})
                  </li>
                ))}
              </ul>
            ) : null}
            <IdentityStateList rows={identity.rows} subjectId={identity.subjectId} onRestore={restoreRegisterValueAction} />
          </section>
        ) : null}

        <div className="mt-6">
          <CompanyProfileForm
            key={`${pickIco ?? "new"}-${setupCountry}-${saved ?? ""}-${view.profile ? [view.profile.legalName, view.profile.address, view.profile.dic, view.profile.icDph].join("|") : ""}`}
            companyId={companyId}
            folderName={view.companyName}
            initialCountry={setupCountry}
            initialProfile={view.profile}
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
