import { formatDateTime } from "@/modules/format-sk";

/** Who sees one company under the Drive sharing rule, as the settings screen shows it. */
export type DriveAccessRow = {
  companyId: number;
  name: string;
  groupName: string | null;
  /** When the sharing was last read; null before the first successful read. */
  refreshedAt: string | null;
  error: string | null;
  /** Allowlisted emails the rule lets see the company. */
  visibleTo: string[];
  /** Group grants: reported, not expanded. */
  groups: Array<{ email: string; role: string }>;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "vlastník",
  organizer: "správca",
  fileOrganizer: "správca obsahu",
  writer: "editor",
  commenter: "komentátor",
  reader: "čitateľ",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * *Prístup z Drive*: per company, which allowlisted users the sharing lets see it, and
 * the group grants Hugo cannot expand. Shown so the office can check before anything
 * is restricted by it.
 */
export function DriveAccessSection({ rows }: { rows: DriveAccessRow[] }) {
  return (
    <section aria-labelledby="settings-access" className="mt-7 pb-24">
      <div className="mx-4 mb-1.5">
        <h2 id="settings-access" className="eyebrow">
          Prístup z Drive
        </h2>
      </div>
      <div className="inset-group">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-ink-3">Zatiaľ nie sú načítané žiadne firmy.</p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.companyId}
              data-testid="drive-access-row"
              className={`px-4 py-3 ${index > 0 ? "border-t border-line" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium">{row.name}</span>
                {row.groupName && <span className="text-[12.5px] text-ink-3">{row.groupName}</span>}
              </div>
              <p className="mt-1 text-[13px] text-ink-2" data-testid="drive-access-visible">
                Vidia: {row.visibleTo.length > 0 ? row.visibleTo.join(", ") : "nikto z prihlásených"}
              </p>
              {row.groups.length > 0 && (
                <p className="mt-0.5 text-[12.5px] text-ink-3" data-testid="drive-access-groups">
                  Skupiny (nepodporované, zdieľaj s ľuďmi priamo):{" "}
                  {row.groups.map((group) => `${group.email} (${roleLabel(group.role)})`).join(", ")}
                </p>
              )}
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                Načítané {row.refreshedAt ? formatDateTime(row.refreshedAt) : "ešte nebolo"}
              </p>
              {row.error && (
                <p className="mt-0.5 text-[12.5px] text-bad" role="alert">
                  Posledné čítanie zlyhalo ({row.error}). Platí predchádzajúci stav.
                </p>
              )}
            </div>
          ))
        )}
      </div>
      <p className="mx-4 mt-1.5 text-[12.5px] text-ink-3">
        Kto vidí firmu, podľa zdieľania jej priečinka v Drive. Zatiaľ sa podľa toho nič neobmedzuje.
      </p>
    </section>
  );
}
