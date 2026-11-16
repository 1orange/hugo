import Link from "next/link";
import type { DirectoryListRow } from "@/lib/subject-directory/screen";
import { IdentityStateSummary } from "@/components/identity/identity-states";

const TONE_CLASSES: Record<DirectoryListRow["verdictTone"], string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-ink-2",
};

const CLIENT_PILL = "ml-2 inline-flex whitespace-nowrap rounded-full bg-accent-soft px-2 py-[2px] align-middle text-[11px] font-semibold text-accent";

/**
 * The Adresár's list of subjects (ADR 0022). A client is marked "Klient": a client company's
 * profile links to the company, an office client (0006/04) has no company and no link. The
 * office's accountant (*Vedie*) and cooperation (*Spolupráca*) show beside it.
 */
export function DirectoryTable({ rows }: { rows: DirectoryListRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[1040px] border-collapse text-left text-[13px]">
        <thead className="bg-surface-2 text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
          <tr>
            <th className="px-3 py-2 font-semibold">Názov</th>
            <th className="px-3 py-2 font-semibold">Krajina</th>
            <th className="px-3 py-2 font-semibold">IČO</th>
            <th className="px-3 py-2 font-semibold">DIČ</th>
            <th className="px-3 py-2 font-semibold">IČ DPH</th>
            <th className="px-3 py-2 font-semibold">Vedie</th>
            <th className="px-3 py-2 font-semibold">Spolupráca</th>
            <th className="px-3 py-2 font-semibold">Stav</th>
            <th className="px-3 py-2 font-semibold">Údaje</th>
            <th className="px-3 py-2 font-semibold">Naposledy videný</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={`directory-row-${row.id}`} className="border-t border-line hover:bg-surface-2">
              <td className="px-3 py-2">
                <Link
                  href={`/adresar/${row.id}`}
                  data-testid={`directory-link-${row.id}`}
                  className="font-medium text-ink hover:text-accent"
                >
                  {row.name}
                </Link>
                {row.client ? (
                  row.client.href ? (
                    <Link href={row.client.href} data-testid={`directory-client-${row.id}`} className={CLIENT_PILL}>
                      Klient
                    </Link>
                  ) : (
                    <span data-testid={`directory-client-${row.id}`} className={CLIENT_PILL}>
                      Klient
                    </span>
                  )
                ) : null}
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.country}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.ico ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.dic ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{row.icDph ?? "—"}</td>
              <td className="px-3 py-2 text-[12.5px] text-ink-2" data-testid={`directory-keeper-${row.id}`}>
                {row.keeper ?? "—"}
              </td>
              <td className="px-3 py-2 text-[12.5px] text-ink-2" data-testid={`directory-cooperation-${row.id}`}>
                {row.cooperation ?? "—"}
              </td>
              <td className="px-3 py-2">
                <span
                  data-testid={`directory-verdict-${row.id}`}
                  className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium ${TONE_CLASSES[row.verdictTone]}`}
                >
                  {row.verdictLabel}
                </span>
              </td>
              <td className="px-3 py-2">
                <IdentityStateSummary summary={row.identity} testId={`directory-identity-${row.id}`} />
              </td>
              <td className="px-3 py-2 text-[12px] text-ink-3">{row.lastSeenLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
