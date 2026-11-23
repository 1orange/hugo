import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getCompanyById } from "@/adapters/store/companies";
import { isCompanyVisible } from "@/lib/access/visibility";
import { getMonthFolder } from "@/adapters/store/month-folders";
import { listActiveRenamesForCompany } from "@/adapters/store/drive-mutations";
import { listStructureDeviationsForCompany } from "@/adapters/store/structure-deviations";
import { getSettings } from "@/adapters/store/settings";
import { companyDisplayName } from "@/modules/company-display-name";
import { describeExpectedLayout, describeFoundLayout } from "@/modules/company-layout";
import { DEVIATION_FORMS, type StructureDeviation } from "@/modules/drive-structure";
import { driveFolderViewUrl } from "@/modules/file-preview";
import { countWithNoun, monthLabel } from "@/modules/format-sk";
import { RepairButton, UndoRenameButton } from "./structure-actions";

type StructurePageProps = {
  params: Promise<{ companyId: string }>;
};

function titleFor(deviation: StructureDeviation): string {
  switch (deviation.kind) {
    case "subfolder-missing":
      return `Chýba priečinok „${deviation.expectedName}“`;
    case "subfolder-repair":
      return `„${deviation.observedName}“ je blízky názvu „${deviation.repair?.targetName}“`;
    case "folder-unrecognised":
      return `Nerozpoznaný priečinok „${deviation.observedName}“`;
    case "month-structure-missing":
      return "Chýba mesačná štruktúra";
  }
}

function adviceFor(deviation: StructureDeviation): string {
  switch (deviation.kind) {
    case "subfolder-missing":
      return "Vytvor ho v Drive s presným názvom. Hugo priečinky nevytvára, takže doklady, ktoré sem patria, zatiaľ nemajú kam ísť.";
    case "subfolder-repair":
      return "Doklady v tomto priečinku sa nezobrazia, kým sa názov neopraví. Premenovanie v Drive nerozbije odkazy klientov.";
    case "folder-unrecognised":
      return "Ak patrí do štruktúry mesiaca, premenuj ho v Drive na štandardný názov. Ak ide o rozhodnutie klienta, nechaj ho tak. Hugo ho nebude meniť.";
    case "month-structure-missing":
      return "Hugo z tejto štruktúry nečíta doklady a nič v nej nepresúva ani nepremenúva. Vytvor mesačné priečinky v Drive a doklady presuň do nich; ďalšia kontrola odchýlku odstráni.";
  }
}

export default async function CompanyStructurePage({ params }: StructurePageProps) {
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

  // A company the person's Drive sharing does not reach does not exist for them (ADR 0023).
  if (!(await isCompanyVisible(session.user.email, companyIdNum))) {
    notFound();
  }

  const company = await getCompanyById(companyIdNum);
  if (!company) {
    notFound();
  }

  const settings = await getSettings();
  const deviations = await listStructureDeviationsForCompany(companyIdNum);
  const renames = await listActiveRenamesForCompany(companyIdNum);
  const renameRows = await Promise.all(
    renames.map(async (mutation) => ({
      mutation,
      folder: await getMonthFolder(mutation.driveFileId),
    })),
  );
  const repairRows = await Promise.all(
    deviations.map(async (deviation) => ({
      deviation,
      folder: deviation.folderId ? await getMonthFolder(deviation.folderId) : null,
    })),
  );

  const displayName = companyDisplayName(company.name);
  const byMonth = new Map<string, typeof repairRows>();
  for (const row of repairRows) {
    const key = row.deviation.monthKey ?? "";
    byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          { label: displayName, href: `/companies/${companyIdNum}/activity` },
          { label: "Štruktúra" },
        ]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">
            Štruktúra Drive: {displayName}
          </h1>
          <p className="text-[12.5px] text-ink-2">
            Hugo kontroluje, či mesiace aktuálneho roka obsahujú štandardné
            priečinky. Stav sa prepočíta pri každom načítaní, takže oprava v
            Drive odchýlku odstráni.
          </p>
        </header>

        <section aria-label="Odchýlky" className="flex flex-col gap-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            {deviations.length === 0
              ? "Odchýlky"
              : `Odchýlky: ${countWithNoun(deviations.length, DEVIATION_FORMS)}`}
          </h2>

          {deviations.length === 0 ? (
            <p
              data-testid="structure-clean"
              className="rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2"
            >
              Štruktúra zodpovedá štandardu. Žiadne odchýlky.
            </p>
          ) : null}

          {[...byMonth.entries()].map(([monthKey, rows]) => (
            <div key={monthKey || "company"} className="flex flex-col gap-2.5">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[14px] font-semibold">
                  {monthKey ? monthLabel(monthKey) : "Firma"}
                </h3>
                {monthKey ? (
                  <Link
                    href={`/companies/${companyIdNum}/${monthKey}`}
                    className="text-[11.5px] text-accent underline"
                  >
                    Otvoriť mesiac
                  </Link>
                ) : null}
              </div>
              {rows.map(({ deviation, folder }, index) => (
                <article
                  key={`${index}:${deviation.kind}:${deviation.path}`}
                  data-testid={`structure-deviation-${deviation.kind}`}
                  className={`flex flex-col gap-2 rounded-md border p-3 text-[12.5px] ${
                    deviation.severity === "blocking"
                      ? "border-bad/30 bg-bad-soft"
                      : "border-warn/30 bg-warn-soft"
                  }`}
                >
                  <p className="font-medium text-ink">{titleFor(deviation)}</p>
                  <p className="font-mono text-[11.5px] text-ink-3">{deviation.path}</p>
                  <p className="text-ink-2">{adviceFor(deviation)}</p>
                  {deviation.kind === "month-structure-missing" && deviation.layout ? (
                    <>
                      <p data-testid="structure-found" className="text-ink-2">
                        <span className="font-medium text-ink">Nájdené: </span>
                        {describeFoundLayout(deviation.layout)}
                      </p>
                      <p data-testid="structure-expected" className="text-ink-2">
                        <span className="font-medium text-ink">Očakáva sa: </span>
                        {describeExpectedLayout(deviation.layout.year)}
                      </p>
                    </>
                  ) : null}
                  {deviation.kind === "month-structure-missing" && deviation.folderId ? (
                    <a
                      href={driveFolderViewUrl(deviation.folderId)}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="structure-drive-link"
                      className="w-fit text-[11.5px] text-accent underline"
                    >
                      Otvoriť priečinok klienta v Drive
                    </a>
                  ) : null}
                  {deviation.kind === "subfolder-repair" &&
                  deviation.folderId &&
                  deviation.monthKey &&
                  deviation.repair ? (
                    <RepairButton
                      companyId={companyIdNum}
                      monthKey={deviation.monthKey}
                      driveFolderId={deviation.folderId}
                      targetName={deviation.repair.targetName}
                      canRename={folder?.canRename ?? true}
                      renameBlockedReason={
                        folder && !folder.canRename
                          ? "Drive hlási, že tento priečinok sa nedá premenovať."
                          : null
                      }
                    />
                  ) : null}
                </article>
              ))}
            </div>
          ))}
        </section>

        {renameRows.length > 0 ? (
          <section aria-label="Premenované aplikáciou" className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              Premenované aplikáciou
            </h2>
            <p className="text-[12px] text-ink-2">
              Tieto priečinky premenovala aplikácia. Vrátenie obnoví predchádzajúci
              názov v Drive.
            </p>
            {renameRows.map(({ mutation, folder }) =>
              folder ? (
                <div
                  key={mutation.id}
                  className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 text-[12.5px]"
                >
                  <p className="text-ink">
                    <span className="font-mono text-[11.5px] text-ink-3">{folder.monthKey}</span>{" "}
                    „{mutation.previousName}“ → „{mutation.newName}“
                  </p>
                  <UndoRenameButton
                    companyId={companyIdNum}
                    monthKey={folder.monthKey}
                    mutationId={mutation.id}
                  />
                </div>
              ) : null,
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
