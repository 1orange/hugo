"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { CanonicalListImpact } from "@/modules/folder-settings";
import { PROCESSED_FOLDER_SLOTS } from "@/modules/document-state";
import { PRIECINOK_FORMS, pluralSk } from "@/modules/format-sk";
import { previewCanonicalImpactAction, saveSettingsAction } from "./actions";

type SettingsFormProps = {
  initialDriveParentFolderId: string;
  initialCanonicalFolderNames: string[];
  initialMovableFolderNames: string[];
  initialAutoAdvanceAfterDecision: boolean;
  /** The window start in force (`YYYY_MM`): the stored one, or the default. */
  initialReadingWindowStart: string;
  /** "pred 20 s" — when Drive was last read. */
  lastSweepLabel: string;
};

/** One document type: its folder name, and whether a late arrival in it may be moved (ADR 0006). */
type DocumentType = { name: string; movable: boolean };

type Snapshot = {
  driveParentFolderId: string;
  types: DocumentType[];
  autoAdvance: boolean;
  readingWindowStart: string;
};

const PROCESSED = new Set<string>(PROCESSED_FOLDER_SLOTS);

/** What Hugo does with a type's documents, when it is not "reads them". */
function typeNote(name: string): string | null {
  if (PROCESSED.has(name)) {
    return null;
  }
  if (name === "03 Bankové výpisy") {
    return "Len zaznamená, že výpis prišiel";
  }
  return "Nečíta sa";
}

function typesOf(canonical: readonly string[], movable: readonly string[]): DocumentType[] {
  const movableSet = new Set(movable);
  return canonical.map((name) => ({ name, movable: movableSet.has(name) }));
}

function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** An iOS-style switch: a real button with role="switch". */
function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  labelledBy?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`press relative h-7 w-[46px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-good-dot" : "bg-fill-2"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-transform duration-[260ms] ease-[cubic-bezier(.3,.7,.4,1)] motion-reduce:transition-none ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function GroupHeading({ id, children, trailing }: { id: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mx-4 mb-1.5 flex items-baseline justify-between gap-2">
      <h2 id={id} className="eyebrow">
        {children}
      </h2>
      {trailing}
    </div>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="mx-4 mt-1.5 text-[12.5px] text-ink-3">{children}</p>;
}

/**
 * The office's settings as grouped lists. Nothing is saved until she presses
 * *Uložiť* on the bar that appears when something changed; removing a type
 * shows first which folders would stop being read.
 */
export function SettingsForm({
  initialDriveParentFolderId,
  initialCanonicalFolderNames,
  initialMovableFolderNames,
  initialAutoAdvanceAfterDecision,
  initialReadingWindowStart,
  lastSweepLabel,
}: SettingsFormProps) {
  const [saved, setSaved] = useState<Snapshot>(() => ({
    driveParentFolderId: initialDriveParentFolderId,
    types: typesOf(initialCanonicalFolderNames, initialMovableFolderNames),
    autoAdvance: initialAutoAdvanceAfterDecision,
    readingWindowStart: initialReadingWindowStart,
  }));
  const [current, setCurrent] = useState<Snapshot>(saved);
  const [draftName, setDraftName] = useState("");
  const [impact, setImpact] = useState<CanonicalListImpact | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [previewPending, startPreview] = useTransition();
  const [savePending, startSave] = useTransition();

  const proposedNames = useMemo(() => current.types.map((type) => type.name), [current.types]);
  const savedNames = useMemo(() => saved.types.map((type) => type.name), [saved.types]);
  const namesChanged = JSON.stringify(proposedNames) !== JSON.stringify(savedNames);
  const dirty = !sameSnapshot(current, saved);
  const removedNames = savedNames.filter((name) => !proposedNames.includes(name));

  useEffect(() => {
    if (!namesChanged) {
      setImpact(null);
      setPreviewError(null);
      return;
    }
    startPreview(async () => {
      const result = await previewCanonicalImpactAction(proposedNames);
      if (!result.ok) {
        setImpact(null);
        setPreviewError(result.message);
        return;
      }
      setPreviewError(null);
      setImpact(result.data);
    });
  }, [namesChanged, proposedNames]);

  useEffect(() => {
    if (!savedToast) {
      return;
    }
    const timer = setTimeout(() => setSavedToast(false), 3000);
    return () => clearTimeout(timer);
  }, [savedToast]);

  function update(next: Partial<Snapshot>) {
    setSaveError(null);
    setSavedToast(false);
    setCurrent((value) => ({ ...value, ...next }));
  }

  const trimmedDraft = draftName.trim();
  const cannotAdd = trimmedDraft === "" || proposedNames.includes(trimmedDraft);

  function addType() {
    if (cannotAdd) {
      return;
    }
    update({ types: [...current.types, { name: trimmedDraft, movable: false }] });
    setDraftName("");
  }

  function restoreType(name: string) {
    const original = saved.types.find((type) => type.name === name);
    if (!original) {
      return;
    }
    const order = savedNames;
    const rank = (typeName: string) => {
      const index = order.indexOf(typeName);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    update({ types: [...current.types, original].sort((left, right) => rank(left.name) - rank(right.name)) });
  }

  function onSave() {
    setSaveError(null);
    startSave(async () => {
      const result = await saveSettingsAction({
        driveParentFolderId: current.driveParentFolderId,
        canonicalFolderNames: proposedNames,
        movableFolderNames: current.types.filter((type) => type.movable).map((type) => type.name),
        autoAdvanceAfterDecision: current.autoAdvance,
        readingWindowStart: current.readingWindowStart,
      });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      const stored = result.data.settings;
      const next: Snapshot = {
        driveParentFolderId: stored.effectiveDriveParentFolderId ?? current.driveParentFolderId,
        types: typesOf(stored.canonicalFolderNames, stored.movableFolderNames),
        autoAdvance: stored.autoAdvanceAfterDecision,
        readingWindowStart: stored.effectiveReadingWindowStart,
      };
      setSaved(next);
      setCurrent(next);
      setImpact(null);
      setSavedToast(true);
    });
  }

  const changes =
    Number(current.autoAdvance !== saved.autoAdvance) +
    Number(current.readingWindowStart !== saved.readingWindowStart) +
    Number(current.driveParentFolderId !== saved.driveParentFolderId) +
    Number(JSON.stringify(current.types) !== JSON.stringify(saved.types));

  return (
    <div className="flex flex-col gap-7 pb-24">
      <section aria-labelledby="settings-work">
        <GroupHeading id="settings-work">Práca s dokladmi</GroupHeading>
        <div className="inset-group">
          <div className="flex items-center gap-3 px-4 py-3">
            <span id="auto-advance-label" className="flex-1 text-[14px]">
              Po rozhodnutí prejsť na ďalší doklad
            </span>
            <Switch
              checked={current.autoAdvance}
              onChange={(next) => update({ autoAdvance: next })}
              labelledBy="auto-advance-label"
              testId="auto-advance-toggle"
            />
          </div>
          <label className="flex items-center gap-3 border-t border-line px-4 py-3">
            <span className="shrink-0 text-[14px]">Čítať doklady od</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-right font-mono text-[13px] outline-none focus:text-accent"
              value={current.readingWindowStart}
              onChange={(event) => update({ readingWindowStart: event.target.value })}
              placeholder="RRRR_MM"
              spellCheck={false}
              data-testid="reading-window-start"
            />
          </label>
        </div>
        <Footnote>
          Po potvrdení alebo označení za nerelevantný sa vyberie ďalší doklad, ktorý ešte čaká. Vypnuté zostávaš na tom
          istom doklade. Neuzavreté mesiace od tohto mesiaca dozadu sa čítajú automaticky, aj keď ich nikto neotvorí.
          Staršie mesiace sa čítajú, až keď ich otvoríš. Formát RRRR_MM, napríklad 2026_01.
        </Footnote>
      </section>

      <section aria-labelledby="settings-drive">
        <GroupHeading id="settings-drive">Google Drive</GroupHeading>
        <div className="inset-group">
          <label className="flex items-center gap-3 px-4 py-3">
            <span className="shrink-0 text-[14px]">Nadradený priečinok</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-right font-mono text-[13px] outline-none focus:text-accent"
              value={current.driveParentFolderId}
              onChange={(event) => update({ driveParentFolderId: event.target.value })}
              spellCheck={false}
              data-testid="drive-parent-folder-id"
            />
          </label>
          <div className="flex items-center gap-3 border-t border-line px-4 py-3">
            <span className="flex-1 text-[14px]">Posledné načítanie</span>
            <span className="text-[14px] text-ink-3">{lastSweepLabel}</span>
          </div>
        </div>
        <Footnote>
          Priečinok, v ktorom sú účtovníčky a v nich klienti. Uložená hodnota má prednosť pred premennou prostredia. Na
          presúvanie neskoro doručených dokladov potrebuje servisný účet rolu Správca obsahu.
        </Footnote>
      </section>

      <section aria-labelledby="settings-types">
        <GroupHeading id="settings-types" trailing={<span className="text-[12px] text-ink-3">Presúvať neskoré</span>}>
          Typy dokladov
        </GroupHeading>
        <div className="inset-group" data-testid="canonical-folder-names">
          {current.types.map((type, index) => {
            const match = /^(\d{2})\s+(.*)$/u.exec(type.name);
            const note = typeNote(type.name);
            return (
              <div
                key={type.name}
                className="flex items-center gap-3 border-t border-line py-2.5 pr-3 pl-2.5 first:border-t-0"
                data-testid="document-type-row"
              >
                <button
                  type="button"
                  onClick={() => update({ types: current.types.filter((_, other) => other !== index) })}
                  aria-label={`Odobrať ${type.name}`}
                  title="Odobrať"
                  className="press grid size-[26px] shrink-0 place-items-center rounded-full"
                >
                  <span aria-hidden className="grid size-[18px] place-items-center rounded-full bg-[#e5484d] text-[14px] leading-none font-bold text-white">
                    −
                  </span>
                </button>
                <span className="tabular w-[26px] shrink-0 font-semibold text-ink-3">{match ? match[1] : ""}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">{match ? match[2] : type.name}</span>
                  {note ? <span className="block text-[12px] text-ink-3">{note}</span> : null}
                </span>
                <Switch
                  checked={type.movable}
                  onChange={(next) =>
                    update({
                      types: current.types.map((other, otherIndex) =>
                        otherIndex === index ? { ...other, movable: next } : other,
                      ),
                    })
                  }
                  label={`Presúvať neskoré: ${type.name}`}
                  testId="movable-folder-names"
                />
              </div>
            );
          })}
          <div className="flex items-center gap-3 border-t border-line py-2.5 pr-3 pl-2.5">
            <button
              type="button"
              onClick={addType}
              disabled={cannotAdd}
              aria-label="Pridať typ"
              className="press grid size-[26px] shrink-0 place-items-center rounded-full disabled:opacity-40"
            >
              <span aria-hidden className="grid size-[18px] place-items-center rounded-full bg-good-dot text-[14px] leading-none font-bold text-white">
                +
              </span>
            </button>
            <label className="flex min-w-0 flex-1">
              <span className="sr-only">Nový typ dokladov</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addType();
                  }
                }}
                placeholder="Pridať typ, napr. 09 Pokladňa"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-4"
              />
            </label>
          </div>
        </div>

        {previewError ? (
          <p className="mx-4 mt-2 text-[13px] text-bad" role="alert">
            {previewError}
          </p>
        ) : null}

        {namesChanged && impact ? (
          <div className="mt-2.5 rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-warn-strong" data-testid="canonical-impact-preview">
            <p className="font-semibold">
              {impact.totalAffected === 0
                ? "Žiadny existujúci priečinok by sa nestal nerozpoznaným."
                : `${impact.totalAffected} ${pluralSk(impact.totalAffected, PRIECINOK_FORMS)} by sa ${
                    impact.totalAffected === 1 ? "stal nerozpoznaným" : impact.totalAffected < 5 ? "stali nerozpoznanými" : "stalo nerozpoznanými"
                  }.`}
            </p>
            {impact.totalAffected > 0 ? (
              <p className="mt-0.5">Doklady v nich sa prestanú čítať, kým priečinok niekto nepremenuje alebo typ nevrátiš.</p>
            ) : null}
            {removedNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {removedNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => restoreType(name)}
                    className="press rounded-full bg-surface px-2.5 py-1 text-[12.5px] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
                  >
                    Vrátiť {name}
                  </button>
                ))}
              </div>
            ) : null}
            {impact.newlyRecognisedFolders.length > 0 ? (
              <div className="mt-2.5" data-testid="newly-recognised-folders">
                <p className="font-semibold">
                  {impact.newlyRecognisedFolders.length} {pluralSk(impact.newlyRecognisedFolders.length, PRIECINOK_FORMS)} by
                  sa stalo rozpoznanými
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {impact.newlyRecognisedFolders.map((folder) => (
                    <li key={`${folder.companyId}-${folder.monthKey}-${folder.folderName}`}>
                      {folder.folderName} — {folder.companyName} {folder.monthKey}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {impact.byCompany.length > 0 ? (
              <details className="mt-2.5">
                <summary className="cursor-pointer font-medium">Podľa firmy</summary>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {impact.byCompany.map((entry) => (
                    <li key={entry.companyId}>
                      <span className="font-medium">{entry.companyName}</span>: {entry.count}{" "}
                      {pluralSk(entry.count, PRIECINOK_FORMS)}
                      <ul className="mt-0.5 list-disc pl-5 text-warn">
                        {entry.folders.map((folder) => (
                          <li key={`${folder.monthKey}-${folder.folderName}`}>
                            {folder.monthKey}: {folder.folderName}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {namesChanged && previewPending ? <p className="mx-4 mt-2 text-[13px] text-ink-3">Počítam dopad…</p> : null}

        <Footnote>
          Od januára 2027 sa typ priečinka číta podľa čísla 01–08 na začiatku názvu, nech je za ním čokoľvek. V starších
          mesiacoch najprv podľa názvu (aj starých pomenovaní a blízkych preklepov, ktoré Hugo navrhne opraviť) a podľa
          čísla len pri 01, 02, 03 a 07, ktoré znamenajú to isté ako od 2027; neznámy priečinok so starým číslom 04, 05
          alebo 06 Hugo neodhaduje, ale ukáže ho v štruktúre na premenovanie. „Presúvať neskoré“: doklad,
          ktorý príde do uzavretého mesiaca, smie Hugo navrhnúť na presun do otvoreného.
        </Footnote>
      </section>

      <section aria-labelledby="settings-more">
        <GroupHeading id="settings-more">Ďalšie</GroupHeading>
        <div className="inset-group">
          {[
            { href: "/queue?from=%2Fsettings", label: "Spracovanie dokladov" },
            { href: "/activity", label: "Celý denník aktivity" },
            { href: "/adresar", label: "Adresár subjektov" },
            { href: "/settings/clients", label: "Klienti z hárku" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 border-t border-line px-4 py-3 text-[14px] first:border-t-0 hover:bg-surface-2"
            >
              <span className="flex-1">{item.label}</span>
              <ChevronRight aria-hidden className="size-4 text-ink-4" />
            </Link>
          ))}
        </div>
      </section>

      {dirty ? (
        <div
          role="region"
          aria-label="Neuložené zmeny"
          className="glass rise-in fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] flex-wrap items-center gap-2.5 rounded-2xl py-2 pr-2 pl-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_10px_32px_rgb(0_0_0/0.16)]"
        >
          <span className="text-[13.5px] text-ink-2">
            {changes === 1 ? "1 neuložená zmena" : `${changes} neuložené zmeny`}
          </span>
          {saveError ? (
            <span className="text-[13px] text-bad" role="alert">
              {saveError}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setCurrent(saved);
              setDraftName("");
              setSaveError(null);
            }}
            className="press rounded-[9px] bg-fill px-3 py-1.5 text-[13.5px] font-medium"
          >
            Zahodiť
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={savePending}
            data-testid="save-settings"
            className="press rounded-[9px] bg-accent px-3.5 py-1.5 text-[13.5px] font-semibold text-white disabled:opacity-50"
          >
            {savePending ? "Ukladám…" : "Uložiť"}
          </button>
        </div>
      ) : null}

      {savedToast && !dirty ? (
        <p
          role="status"
          className="rise-in fixed inset-x-0 bottom-6 z-30 mx-auto w-fit rounded-xl bg-[rgb(29_29_31/0.9)] px-4 py-2.5 text-[13.5px] text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)]"
        >
          Nastavenia sú uložené.
        </p>
      ) : null}
    </div>
  );
}
