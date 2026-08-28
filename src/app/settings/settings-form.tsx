"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { CanonicalListImpact } from "@/modules/folder-settings";
import {
  previewCanonicalImpactAction,
  saveSettingsAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SettingsFormProps = {
  initialDriveParentFolderId: string;
  initialCanonicalFolderNames: string[];
  initialMovableFolderNames: string[];
};

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
      setImpact(null);
      setSaveMessage("Settings saved.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Drive parent folder</CardTitle>
          <CardDescription>
            The Google Drive folder that contains all client company folders.
            Once saved here, this value overrides the environment variable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Folder id</span>
            <input
              className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              value={driveParentFolderId}
              onChange={(event) => setDriveParentFolderId(event.target.value)}
              data-testid="drive-parent-folder-id"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canonical folder names</CardTitle>
          <CardDescription>
            One name per line. Matching, repair proposals and month scaffolding
            use this list exactly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <textarea
            className="min-h-48 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            value={canonicalText}
            onChange={(event) => setCanonicalText(event.target.value)}
            data-testid="canonical-folder-names"
          />

          {previewError ? (
            <p className="text-sm text-destructive" role="alert">
              {previewError}
            </p>
          ) : null}

          {canonicalChanged && impact ? (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
              data-testid="canonical-impact-preview"
            >
              <p className="font-medium">
                {impact.totalAffected === 0
                  ? "No existing folders would become unrecognised."
                  : `${impact.totalAffected} existing folder${impact.totalAffected === 1 ? "" : "s"} would become unrecognised.`}
              </p>

              {impact.removedCanonicalNames.length > 0 ? (
                <div className="mt-3">
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    Removed canonical names
                  </p>
                  <p className="text-muted-foreground">
                    Folders matching these names would immediately drop out of
                    their slot:
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
                    {impact.newlyRecognisedFolders.length} folder
                    {impact.newlyRecognisedFolders.length === 1 ? "" : "s"} would
                    become recognised
                  </p>
                  <p className="text-muted-foreground">
                    These are unrecognised today and would match a name you are
                    adding:
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
                  <p className="font-medium">By company</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {impact.byCompany.map((entry) => (
                      <li key={entry.companyId}>
                        <span className="font-medium">{entry.companyName}</span>
                        {": "}
                        {entry.count} folder{entry.count === 1 ? "" : "s"}
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">Computing impact…</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movable folders</CardTitle>
          <CardDescription>
            Late-arriving documents in these folders may be proposed for move
            into the open month. One name per line; each must be a canonical
            folder name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            value={movableText}
            onChange={(event) => setMovableText(event.target.value)}
            data-testid="movable-folder-names"
          />
        </CardContent>
      </Card>

      {saveError ? (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}
      {saveMessage ? (
        <p className="text-sm text-green-700 dark:text-green-400" role="status">
          {saveMessage}
        </p>
      ) : null}

      <div>
        <Button
          type="button"
          onClick={onSave}
          disabled={savePending}
          data-testid="save-settings"
        >
          {savePending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
