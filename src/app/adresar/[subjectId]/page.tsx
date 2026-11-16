import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { AppBar } from "@/components/app/app-bar";
import { getSettings } from "@/adapters/store/settings";
import { loadSubjectDetail, type DetailField, type VerdictTone } from "@/lib/subject-directory/screen";
import { correctSubjectAction, restoreRegisterValueAction } from "../actions";
import { SubjectCorrectionForm, type CorrectableFieldView } from "../subject-correction-form";
import { countWithNoun } from "@/modules/format-sk";
import { isCorrectableSubjectField } from "@/modules/subject-screen";
import { IdentityStateBadge } from "@/components/identity/identity-states";
import { RestoreRegisterValueButton } from "@/components/identity/restore-register-value-button";

type SubjectPageProps = {
  params: Promise<{ subjectId: string }>;
};

const TONE_CLASSES: Record<VerdictTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-ink-2",
};

const DOCUMENT_FORMS = ["doklad", "doklady", "dokladov"] as const;

function SourceBadge({ field }: { field: DetailField }) {
  if (field.manual) {
    return (
      <span
        data-testid={`subject-source-${field.field}`}
        className="inline-flex whitespace-nowrap rounded-full bg-accent-soft px-2 py-[2px] text-[11px] font-semibold text-accent"
      >
        ručne
      </span>
    );
  }
  return (
    <span data-testid={`subject-source-${field.field}`} className="text-[11.5px] text-ink-3">
      {field.sourceLabel}
    </span>
  );
}

export default async function SubjectPage({ params }: SubjectPageProps) {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    redirect("/sign-in");
  }

  if (!isEmailAllowed(session.user.email, allowlist)) {
    redirect("/auth/refused");
  }

  const { subjectId } = await params;
  const id = Number(subjectId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const detail = await loadSubjectDetail(id);
  if (!detail) {
    notFound();
  }
  const settings = await getSettings();

  const title = detail.legalName ?? detail.aliases[0]?.displayName ?? "Bez názvu v registri";
  const correctable: CorrectableFieldView[] = detail.fields
    .filter((field) => field.correctable && isCorrectableSubjectField(field.field))
    .map((field) => ({
      field: field.field as CorrectableFieldView["field"],
      label: field.label,
      value: field.value,
    }));

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppBar
        crumbs={[
          { label: "Firmy", href: "/companies" },
          { label: "Adresár", href: "/adresar" },
          { label: title },
        ]}
        email={session.user.email}
        lastSweepAt={settings.lastSweepAt}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[20px] font-semibold tracking-[-0.01em]" data-testid="subject-title">
              {title}
            </h1>
            <span
              data-testid="subject-verdict"
              className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium ${TONE_CLASSES[detail.verdictTone]}`}
            >
              {detail.verdictLabel}
            </span>
          </div>
          <p className="text-[12.5px] text-ink-2">
            {detail.country}
            {detail.ico ? ` · IČO ${detail.ico}` : ""} · overené: {detail.verifiedAtLabel} · naposledy videný:{" "}
            {detail.lastSeenLabel}
          </p>
          <p className="text-[12px] text-ink-3">
            Adresár je spoločný pre všetky firmy, ktoré tento subjekt používajú. Doklady, ktoré ho obsahujú, sú
            vypísané nižšie.
          </p>
        </header>

        <section aria-label="Údaje" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Údaje a ich zdroj</h2>
          <table className="w-full border-collapse text-left text-[13px]" data-testid="subject-fields">
            <tbody>
              {detail.fields.map((field) => (
                <tr key={field.field} className="border-t border-line first:border-t-0" data-testid={`subject-field-${field.field}`}>
                  <th scope="row" className="w-44 py-2 pr-4 align-top font-medium text-ink-2">
                    {field.label}
                  </th>
                  <td className="py-2 pr-4 font-mono text-[12.5px] text-ink">{field.value ?? "—"}</td>
                  <td className="py-2 pr-4 align-top">
                    {field.identity ? (
                      <IdentityStateBadge
                        state={field.identity.state}
                        label={field.identity.stateLabel}
                        tone={field.identity.tone}
                        testId={`subject-state-${field.field}`}
                      />
                    ) : (
                      <SourceBadge field={field} />
                    )}
                  </td>
                  <td className="py-2 align-top text-[12px] text-ink-3">
                    {field.identity?.restorable && field.identity.registerValue !== null ? (
                      <div className="flex flex-col items-start gap-2">
                        <span>
                          register:{" "}
                          <span className="font-mono text-ink-2" data-testid={`subject-register-${field.field}`}>
                            {field.identity.registerValue}
                          </span>
                        </span>
                        <RestoreRegisterValueButton
                          subjectId={detail.id}
                          field={field.identity.field}
                          onRestore={restoreRegisterValueAction}
                          testId={`subject-restore-${field.field}`}
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.formerNames.length > 0 ? (
            <div className="text-[12.5px]">
              <span className="font-medium text-ink-2">Bývalé názvy: </span>
              {detail.formerNames.join("; ")}
            </div>
          ) : null}
          {detail.vies.length > 0 ? (
            <ul className="text-[12.5px] text-ink-2" data-testid="subject-vies">
              {detail.vies.map((vies) => (
                <li key={vies.vatId}>
                  VIES {vies.vatId}: {vies.label} (overené {vies.checkedLabel})
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[12.5px] text-ink-2" data-testid="subject-register-status">
            Stav v registri: {detail.registerStatusLabel}
          </p>
        </section>

        <section aria-label="Nálezy" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Nálezy</h2>
          {detail.findings.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">Bez nálezov.</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-bad" data-testid="subject-findings">
              {detail.findings.map((finding) => (
                <li key={`${finding.field}-${finding.kind}`}>{finding.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Opraviť" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Opraviť údaje</h2>
          <p className="text-[12.5px] text-ink-2">
            Ručne opravená hodnota je označená „ručne“ a register ju pri ďalšom overení neprepíše. Ak register
            s ňou nesúhlasí, zobrazí sa nález.
          </p>
          <div className="max-w-md">
            <SubjectCorrectionForm subjectId={detail.id} fields={correctable} onCorrect={correctSubjectAction} />
          </div>
        </section>

        <section aria-label="Názvy na dokladoch" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Názvy na dokladoch</h2>
          {detail.aliases.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">Zatiaľ žiadny názov nebol na doklade.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-[12.5px]">
              {detail.aliases.map((alias) => (
                <li key={alias.displayName} className="rounded-md border border-line bg-surface-2 px-2.5 py-1">
                  {alias.displayName} <span className="text-ink-3">× {alias.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Firmy" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Firmy</h2>
          {detail.linkedCompany ? (
            <p className="text-[12.5px]">
              Táto firma je klientom:{" "}
              <Link href={detail.linkedCompany.href} className="text-accent underline" data-testid="subject-linked-company">
                {detail.linkedCompany.name}
              </Link>
            </p>
          ) : null}
          {detail.references.companies.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">Žiadna firma tento subjekt zatiaľ nepoužila.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-[12.5px]" data-testid="subject-companies">
              {detail.references.companies.map((company) => (
                <li key={company.id}>
                  <Link href={company.href} className="rounded-md border border-line-2 px-2.5 py-1 hover:text-accent">
                    {company.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Doklady" className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            Doklady: {countWithNoun(detail.references.documents.length, DOCUMENT_FORMS)}
          </h2>
          {detail.references.documents.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">Žiadny doklad tento subjekt zatiaľ neobsahuje.</p>
          ) : (
            <table className="w-full border-collapse text-left text-[13px]" data-testid="subject-documents">
              <thead className="text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Doklad</th>
                  <th className="py-2 pr-4 font-semibold">Firma</th>
                  <th className="py-2 font-semibold">Mesiac</th>
                </tr>
              </thead>
              <tbody>
                {detail.references.documents.map((document) => (
                  <tr key={document.documentId} className="border-t border-line" data-testid={`subject-document-${document.documentId}`}>
                    <td className="py-2 pr-4">
                      <Link href={document.href} className="text-accent underline">
                        {document.fileName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-ink-2">{document.companyName}</td>
                    <td className="py-2 text-ink-2">{document.monthLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11.5px] text-ink-3">
            Údaj, ktorý na doklade chýba, sa zobrazí z opravy pri ďalšom otvorení dokladu. Overenie dokladu sa
            na pozadí zopakuje.
          </p>
        </section>
      </main>
    </div>
  );
}
