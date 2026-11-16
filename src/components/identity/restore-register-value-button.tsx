"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RESTORE_REGISTER_VALUE_LABEL } from "@/modules/identity-states";

export type RestoreResult = { ok: true } | { ok: false; message: string };

/**
 * The one-click return to the register's value (0006/03). The action comes in as a prop,
 * so the button can be mounted without the server; a success refreshes the page, which
 * then shows the field as overené.
 */
export function RestoreRegisterValueButton({
  subjectId,
  field,
  onRestore,
  testId,
}: {
  subjectId: number;
  field: string;
  onRestore: (input: { subjectId: number; field: string }) => Promise<RestoreResult>;
  testId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function restore() {
    setMessage(null);
    startTransition(async () => {
      const result = await onRestore({ subjectId, field });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={restore}
        disabled={pending}
        data-testid={testId}
        className="press rounded-md border border-line-2 bg-surface px-2.5 py-1 text-[12px] font-medium text-accent hover:border-accent disabled:opacity-50"
      >
        {pending ? "Vraciam…" : RESTORE_REGISTER_VALUE_LABEL}
      </button>
      {message ? (
        <span role="alert" className="text-[12px] text-bad">
          {message}
        </span>
      ) : null}
    </span>
  );
}
