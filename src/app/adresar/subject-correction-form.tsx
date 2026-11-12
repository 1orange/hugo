"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { SubjectCorrectionResult } from "./actions";
import type { CorrectableSubjectField } from "@/modules/subject-screen";

export type CorrectableFieldView = {
  field: CorrectableSubjectField;
  label: string;
  value: string | null;
};

const HINTS: Partial<Record<CorrectableSubjectField, string>> = {
  dic: "SK: 10 číslic. CZ: CZ a 8 až 10 číslic.",
  icDph: "SK a 10 číslic, deliteľné 11. CZ: CZ a 8 až 10 číslic.",
  vatGroupId: "Prázdne, ak firma nie je členom skupiny DPH.",
  address: "Prázdne vymaže adresu.",
};

/**
 * Her corrections of a subject (ADR 0022): each changed field is sent on its own, so
 * each correction is checked, stored and logged on its own. The action comes in as a
 * prop, so the screen can be mounted without the server.
 */
export function SubjectCorrectionForm({
  subjectId,
  fields,
  onCorrect,
}: {
  subjectId: number;
  fields: CorrectableFieldView[];
  onCorrect: (input: { subjectId: number; field: string; value: string }) => Promise<SubjectCorrectionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((field) => [field.field, field.value ?? ""])),
  );
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string; field?: string } | null>(null);

  function changedFields(): CorrectableFieldView[] {
    return fields.filter((field) => (values[field.field] ?? "").trim() !== (field.value ?? "").trim());
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changed = changedFields();
    if (changed.length === 0) {
      setMessage({ tone: "bad", text: "Nič sa nezmenilo." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      let saved = 0;
      for (const field of changed) {
        const result = await onCorrect({ subjectId, field: field.field, value: values[field.field] ?? "" });
        if (!result.ok) {
          setMessage({ tone: "bad", text: `${field.label}: ${result.message}`, field: field.field });
          if (saved > 0) {
            router.refresh();
          }
          return;
        }
        saved += 1;
      }
      setMessage({ tone: "good", text: saved === 1 ? "Úprava uložená." : `Úpravy uložené (${saved}).` });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="subject-correction-form">
      {fields.map((field) => (
        <label key={field.field} className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{field.label}</span>
          <input
            name={field.field}
            data-testid={`subject-field-input-${field.field}`}
            value={values[field.field] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [field.field]: event.target.value }))}
            disabled={pending}
            className="rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
          />
          {HINTS[field.field] ? <span className="text-[11.5px] text-ink-3">{HINTS[field.field]}</span> : null}
          {message?.field === field.field ? (
            <span className="text-[12px] text-bad" role="alert">
              {message.text}
            </span>
          ) : null}
        </label>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          data-testid="subject-correct-submit"
          className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-surface disabled:opacity-50"
        >
          {pending ? "Ukladám…" : "Uložiť opravy"}
        </button>
        {message && !message.field ? (
          <span
            role={message.tone === "bad" ? "alert" : "status"}
            data-testid={message.tone === "good" ? "subject-correct-saved" : "subject-correct-error"}
            className={`text-[12.5px] ${message.tone === "good" ? "text-good" : "text-bad"}`}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
