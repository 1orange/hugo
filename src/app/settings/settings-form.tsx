"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { CanonicalListImpact } from "@/modules/folder-settings";
import { PRIECINOK_FORMS, pluralSk } from "@/modules/format-sk";
import {
  previewCanonicalImpactAction,
  saveSettingsAction,
} from "./actions";

type SettingsFormProps = {
  initialDriveParentFolderId: string;
  initialCanonicalFolderNames: string[];
  initialMovableFolderNames: string[];
  initialAutoAdvanceAfterDecision: boolean;
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-[15px]">{title}</h2>
        <p className="mt-1 text-[12.5px] text-ink-2">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function namesToText(names: readonly string[]): string {
  return names.join("\n");
}

function textToNames(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function SettingsForm({
  initialDriveParentFolderId,
  initialCanonicalFolderNames,
  initialMovableFolderNames,
  initialAutoAdvanceAfterDecision,
}: SettingsFormProps) {
  const [driveParentFolderId, setDriveParentFolderId] = useState(
    initialDriveParentFolderId,
  );
  const [savedCanonicalNames, setSavedCanonicalNames] = useState(
    initialCanonicalFolderNames,
  );
  const [canonicalText, setCanonicalText] = useState(
    namesToText(initialCanonicalFolderNames),
  );
  const [movableText, setMovableText] = useState(
    namesToText(initialMovableFolderNames),
  );
  const [autoAdvance, setAutoAdvance] = useState(initialAutoAdvanceAfterDecision);
  const [impact, setImpact] = useState<CanonicalListImpact | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [savePending, startSave] = useTransition();

  const proposedCanonicalNames = useMemo(
    () => textToNames(canonicalText),
    [canonicalText],
  );

  const canonicalChanged = useMemo(
    () =>
      JSON.stringify(proposedCanonicalNames) !==
      JSON.stringify(savedCanonicalNames),
    [proposedCanonicalNames, savedCanonicalNames],
  );

  useEffect(() => {
    if (!canonicalChanged) {
      setImpact(null);
      setPreviewError(null);
      return;
    }

    startPreview(async () => {
      const result = await previewCanonicalImpactAction(proposedCanonicalNames);
      if (!result.ok) {
        setImpact(null);
        setPreviewError(result.message);
        return;
      }
      setPreviewError(null);
      setImpact(result.data);
    });
  }, [canonicalChanged, proposedCanonicalNames]);

  function onSave() {
    setSaveError(null);
    setSaveMessage(null);
    startSave(async () => {
      const result = await saveSettingsAction({
        driveParentFolderId,
        canonicalFolderNames: proposedCanonicalNames,
        movableFolderNames: textToNames(movableText),
        autoAdvanceAfterDecision: autoAdvance,
      });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      setCanonicalText(
        namesToText(result.data.settings.canonicalFolderNames),
      );
      setSavedCanonicalNames(result.data.settings.canonicalFolderNames);
      setMovableText(namesToText(result.data.settings.movableFolderNames));
      setDriveParentFolderId(
        result.data.settings.effectiveDriveParentFolderId ?? driveParentFolderId,
      );
      setAutoAdvance(result.data.settings.autoAdvanceAfterDecision);
      setImpact(null);
      setSaveMessage("Nastavenia sú uložené.");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Ako pracujem s dokladmi"
        description="Drobnosti, ktoré menia tempo práce na obrazovke dokladov."
      >
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(event) => setAutoAdvance(event.target.checked)}
            data-testid="auto-advance-toggle"
            className="mt-0.5 size-4 accent-[color:var(--color-accent)]"
          />
          <span>
            <span className="block text-sm font-medium">
              Po rozhodnutí prejsť na ďalší doklad
            </span>
            <span className="block text-[12.5px] text-ink-2">
              Po potvrdení alebo označení za nerelevantný sa vyberie ďalší doklad,
              ktorý ešte čaká na rozhodnutie. Vypnuté zostávaš na tom istom doklade.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Nadradený priečinok Drive"
        description="Priečinok Google Drive, v ktorom sú priečinky všetkých firiem klientov. Uložená hodnota má prednosť pred premennou prostredia."
      >
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">ID priečinka</span>
          <input
            className="rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm"
            value={driveParentFolderId}
            onChange={(event) => setDriveParentFolderId(event.target.value)}
            data-testid="drive-parent-folder-id"
          />
        </label>
      </Section>

      <Section
        title="Kanonické názvy priečinkov"
        description="Jeden názov na riadok. Rozpoznávanie, návrhy opráv aj zakladanie mesiacov používajú presne tento zoznam."
      >
        <div className="flex flex-col gap-4">
          <textarea
            className="min-h-48 rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm"
            value={canonicalText}
            onChange={(event) => setCanonicalText(event.target.value)}
            data-testid="canonical-folder-names"
          />

          {previewError ? (
            <p className="text-sm text-bad" role="alert">
              {previewError}
            </p>
          ) : null}

          {canonicalChanged && impact ? (
            <div
              className="rounded-md border border-warn/30 bg-warn-soft p-4 text-sm"
              data-testid="canonical-impact-preview"
            >
              <p className="font-medium text-warn">
                {impact.totalAffected === 0
                  ? "Žiadny existujúci priečinok by sa nestal nerozpoznaným."
                  : `${impact.totalAffected} ${pluralSk(impact.totalAffected, PRIECINOK_FORMS)} by sa stalo nerozpoznanými.`}
              </p>

              {impact.removedCanonicalNames.length > 0 ? (
                <div className="mt-3">
                  <p className="font-medium">Odstránené kanonické názvy</p>
                  <p className="text-ink-2">
                    Priečinky s týmito názvami by okamžite vypadli zo svojho miesta:
                  </p>
                  <ul className="mt-2 list-disc pl-5">
                    {impact.removedCanonicalNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {impact.newlyRecognisedFolders.length > 0 ? (
                <div className="mt-3" data-testid="newly-recognised-folders">
                  <p className="font-medium">
                    {impact.newlyRecognisedFolders.length}{" "}
                    {pluralSk(impact.newlyRecognisedFolders.length, PRIECINOK_FORMS)}{" "}
                    by sa stalo rozpoznanými
                  </p>
                  <p className="text-ink-2">
                    Dnes sú nerozpoznané a zodpovedali by názvu, ktorý pridávaš:
                  </p>
                  <ul className="mt-2 list-disc pl-5">
                    {impact.newlyRecognisedFolders.map((folder) => (
                      <li
                        key={`${folder.companyId}-${folder.monthKey}-${folder.folderName}`}
                      >
                        {folder.folderName} — {folder.companyName} {folder.monthKey}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {impact.byCompany.length > 0 ? (
                <div className="mt-3">
                  <p className="font-medium">Podľa firmy</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {impact.byCompany.map((entry) => (
                      <li key={entry.companyId}>
                        <span className="font-medium">{entry.companyName}</span>
                        {": "}
                        {entry.count} {pluralSk(entry.count, PRIECINOK_FORMS)}
                        <ul className="mt-1 list-disc pl-5 text-ink-2">
                          {entry.folders.map((folder) => (
                            <li key={`${folder.monthKey}-${folder.folderName}`}>
                              {folder.monthKey}: {folder.folderName}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {canonicalChanged && previewPending ? (
            <p className="text-sm text-ink-3">Počítam dopad…</p>
          ) : null}
        </div>
      </Section>

      <Section
        title="Presunuteľné priečinky"
        description="Neskoro doručené doklady v týchto priečinkoch smie aplikácia navrhnúť na presun do otvoreného mesiaca. Jeden názov na riadok; každý musí byť kanonickým názvom priečinka."
      >
        <textarea
          className="min-h-32 w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm"
          value={movableText}
          onChange={(event) => setMovableText(event.target.value)}
          data-testid="movable-folder-names"
        />
      </Section>

      {saveError ? (
        <p className="text-sm text-bad" role="alert">
          {saveError}
        </p>
      ) : null}
      {saveMessage ? (
        <p className="text-sm text-good" role="status">
          {saveMessage}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onSave}
          disabled={savePending}
          data-testid="save-settings"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50"
        >
          {savePending ? "Ukladám…" : "Uložiť nastavenia"}
        </button>
      </div>
    </div>
  );
}
