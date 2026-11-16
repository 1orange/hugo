import { sameIdentityValue } from "./subject-directory";

/**
 * The state of each identity field a client's subject shows (0006/03, ADR 0022):
 * overené (the register or VIES confirms it), upravené ručne (she typed it, and the
 * register says otherwise or has not confirmed it) or neoverené (nothing confirms it
 * yet: no answer, an outage, or the subject is not in the register). Pure: the
 * subject's values, sources, manual list, findings and VIES records in; each field's
 * state and the register's value out, for the screens to show beside a hand edit.
 */

export const IDENTITY_FIELDS = ["legalName", "address", "ico", "dic", "icDph"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type IdentityFieldState = "overene" | "upravene-rucne" | "neoverene";

/**
 * The subject as the states read it. Sources are plain strings: the client sheet's
 * `sheet` is a value no register confirmed, which is all this needs to know of it.
 */
export type IdentitySubject = {
  ico: string | null;
  legalName: string | null;
  address: string | null;
  dic: string | null;
  icDph: string | null;
  /** "unknown" until a register has found the subject: then active or dissolved. */
  registerStatus: string;
  sources: Partial<Record<string, string>>;
  manualFields: readonly string[];
  findings: ReadonlyArray<{ field: string; kind: string; value: string }>;
  viesStatus: Readonly<Record<string, { valid: boolean; lapsedAt: string | null }>>;
};

export type IdentityFieldView = {
  field: IdentityField;
  state: IdentityFieldState;
  /** What the subject holds; null when nothing does. */
  value: string | null;
  /** What the register (or VIES) last said, when it said anything about this field. */
  registerValue: string | null;
  /** Her hand edit, as the screens mark it. */
  manual: boolean;
  source: string | null;
};

const STATE_LABELS: Record<IdentityFieldState, string> = {
  overene: "overené",
  "upravene-rucne": "upravené ručne",
  neoverene: "neoverené",
};

const FIELD_LABELS: Record<IdentityField, string> = {
  legalName: "Právny názov",
  address: "Adresa",
  ico: "IČO",
  dic: "DIČ",
  icDph: "IČ DPH",
};

/** The button that returns a hand-edited field to the register's value. */
export const RESTORE_REGISTER_VALUE_LABEL = "Vrátiť hodnotu z registra";

export function identityStateLabel(state: IdentityFieldState): string {
  return STATE_LABELS[state];
}

export function identityFieldLabel(field: IdentityField): string {
  return FIELD_LABELS[field];
}

/** The colour of a state: verified is good, a hand edit a warning, unverified quiet. */
export function identityStateTone(state: IdentityFieldState): "good" | "warn" | "neutral" {
  switch (state) {
    case "overene":
      return "good";
    case "upravene-rucne":
      return "warn";
    case "neoverene":
      return "neutral";
  }
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The field's state from what it holds, where it came from, and what the register said of it. */
export function identityFieldState(input: {
  field: Exclude<IdentityField, "ico">;
  value: string | null;
  source: string | null;
  manual: boolean;
  /** The register's (or VIES's) last answer for the field; null when it said nothing usable. */
  registerValue: string | null;
  /** Whether the register or VIES answered about the subject at all. */
  answered: boolean;
}): { state: IdentityFieldState; registerValue: string | null } {
  const { field, value, source, manual, registerValue, answered } = input;
  if (value === null) {
    // Her cleared field, which the register holds otherwise, is a hand edit she can return.
    return { state: manual && registerValue !== null ? "upravene-rucne" : "neoverene", registerValue };
  }
  if (registerValue !== null && sameIdentityValue(field, value, registerValue)) {
    return { state: "overene", registerValue };
  }
  // Whatever the register or VIES confirmed is verified, whatever the value said last.
  if (source === "register" || source === "vies") {
    return { state: "overene", registerValue };
  }
  // Her typing, which the register does not confirm: differing, or with no answer to check it against.
  if (manual && (answered || registerValue !== null)) {
    return { state: "upravene-rucne", registerValue };
  }
  // A sheet value or a value of unknown origin that nothing confirms.
  return { state: "neoverene", registerValue };
}

/**
 * The five identity fields of a client's subject, in the order the screens show them,
 * each with its state. Only a register or VIES answer makes a field overené; her own
 * typing is upravené ručne once the register answered and says otherwise.
 */
export function identityFieldViews(subject: IdentitySubject): IdentityFieldView[] {
  const found = subject.registerStatus !== "unknown";
  return IDENTITY_FIELDS.map((field): IdentityFieldView => {
    const value = trimmedOrNull(subject[field]);
    const source = subject.sources[field] ?? null;
    if (field === "ico") {
      // The IČO is the subject's key: confirmed when a register holds the subject under it.
      return {
        field,
        state: value !== null && found ? "overene" : "neoverene",
        value,
        registerValue: found ? value : null,
        manual: false,
        source,
      };
    }
    const manual = subject.manualFields.includes(field) || source === "manual";
    if (field === "icDph") {
      const record = value === null ? undefined : subject.viesStatus[value.replace(/\s+/g, "").toUpperCase()];
      const registerValue = record && record.valid && record.lapsedAt === null ? value : null;
      return {
        field,
        ...identityFieldState({ field, value, source, manual, registerValue, answered: record !== undefined }),
        value,
        manual,
        source,
      };
    }
    // The register answered the field when it holds a value for it; a field it does not hold has no answer.
    const finding = subject.findings.find((item) => item.field === field && item.kind === "register-disagrees");
    const kept = manual || (source !== null && source !== "register" && source !== "vies");
    let registerValue: string | null = null;
    if (found) {
      registerValue = kept ? (finding?.value ?? null) : value;
    }
    return {
      field,
      ...identityFieldState({ field, value, source, manual, registerValue, answered: found }),
      value,
      manual,
      source,
    };
  });
}

/** One identity field as a screen shows it: its Slovak label, its state and the register's value beside a hand edit. */
export type IdentityRow = {
  field: IdentityField;
  label: string;
  value: string | null;
  state: IdentityFieldState;
  stateLabel: string;
  tone: "good" | "warn" | "neutral";
  registerValue: string | null;
  /** Whether the one-click return to the register's value is offered. */
  restorable: boolean;
};

export function identityRowsOf(subject: IdentitySubject): IdentityRow[] {
  return identityFieldViews(subject).map((view) => ({
    field: view.field,
    label: identityFieldLabel(view.field),
    value: view.value,
    state: view.state,
    stateLabel: identityStateLabel(view.state),
    tone: identityStateTone(view.state),
    registerValue: view.registerValue,
    restorable: canRestoreRegisterValue(view),
  }));
}

export type IdentitySummary = Record<"overene" | "upraveneRucne" | "neoverene", number>;

/** How many of a subject's fields are in each state: the Adresár list's compact summary. */
export function identitySummary(fields: ReadonlyArray<{ state: IdentityFieldState }>): IdentitySummary {
  const summary: IdentitySummary = { overene: 0, upraveneRucne: 0, neoverene: 0 };
  for (const view of fields) {
    if (view.state === "overene") summary.overene += 1;
    else if (view.state === "upravene-rucne") summary.upraveneRucne += 1;
    else summary.neoverene += 1;
  }
  return summary;
}

/** Whether the screens offer the one-click return: a hand edit beside a value the register holds. */
export function canRestoreRegisterValue(view: IdentityFieldView): boolean {
  return view.state === "upravene-rucne" && view.registerValue !== null;
}
