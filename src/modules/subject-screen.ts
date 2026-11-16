import type { IntegrityVerdict } from "./subject-integrity";
import {
  groupVatIdOf,
  type SubjectField,
  type SubjectFinding,
  type SubjectSource,
  type ViesRecord,
} from "./subject-directory";

/**
 * What the *Adresár* screens say about a subject (ADR 0015 conventions, ADR 0022):
 * its verdict, where each value came from, the fields she may correct and how a
 * correction is checked. Pure, so the Slovak wording is tested with the rules.
 */

/** The fields she may correct on the screen; the rules of subject-directory allow these. */
export const CORRECTABLE_SUBJECT_FIELDS = ["legalName", "address", "dic", "icDph", "vatGroupId"] as const;
export type CorrectableSubjectField = (typeof CORRECTABLE_SUBJECT_FIELDS)[number];

const FIELD_LABELS: Record<SubjectField, string> = {
  legalName: "Názov",
  formerNames: "Bývalé názvy",
  address: "Adresa",
  dic: "DIČ",
  icDph: "IČ DPH",
  vatGroupId: "IČ DPH skupiny",
  registerStatus: "Stav v registri",
};

/** The Slovak name of a subject field, as the screens print it. */
export function correctableFieldLabel(field: SubjectField): string {
  return FIELD_LABELS[field];
}

const SOURCE_LABELS: Record<SubjectSource, string> = {
  register: "z registra",
  vies: "z VIES",
  manual: "ručne",
  sheet: "z klientskeho hárku",
};

/** Where a value came from: a field nothing has set reads as a dash, not as a source. */
export function sourceLabel(source: SubjectSource | undefined): string {
  return source ? SOURCE_LABELS[source] : "—";
}

/** The subject as its verdict reads it: the directory row, values only. */
export type SubjectVerdictInput = {
  country: "SK" | "CZ" | "foreign";
  legalName: string | null;
  registerStatus: "active" | "dissolved" | "unknown";
  verifiedAt: string | null;
  findings: ReadonlyArray<SubjectFinding>;
  viesStatus: Record<string, ViesRecord>;
};

/**
 * One verdict for a subject, from what the directory holds (ADR 0022). A finding, a
 * dissolved registration or a lapsed VIES number is a mismatch; a subject nobody
 * has checked (or a foreign one, which no register answers) cannot be verified;
 * one the register does not list is a notice; the rest are verified. A manual
 * correction is not a problem: it is her decision, and it still verifies the rest.
 */
export function subjectVerdictOf(subject: SubjectVerdictInput): IntegrityVerdict {
  const lapsed = Object.values(subject.viesStatus).some((record) => !record.valid && record.lapsedAt !== null);
  if (subject.findings.length > 0 || subject.registerStatus === "dissolved" || lapsed) {
    return "mismatch";
  }
  if (subject.verifiedAt === null || subject.country === "foreign") {
    return "unverifiable";
  }
  if (subject.legalName === null) {
    return "notice";
  }
  return "verified";
}

/** What VIES said about one VAT ID of the subject, in Slovak. */
export function viesStatusLabel(record: ViesRecord): string {
  if (record.valid) {
    return "platné";
  }
  return record.lapsedAt !== null ? "už neplatné" : "neregistrované";
}

/** A directory finding as one Slovak sentence; the detail screen lists them. */
export function directoryFindingMessage(finding: SubjectFinding): string {
  const label = correctableFieldLabel(finding.field);
  return `${label}: register dnes uvádza „${finding.value}“, ručná oprava sa líši.`;
}

export function isCorrectableSubjectField(field: string): field is CorrectableSubjectField {
  return (CORRECTABLE_SUBJECT_FIELDS as readonly string[]).includes(field);
}

/** The register's word for a subject's standing (ADR 0022: active or dissolved; unknown until asked). */
export function registerStatusLabelOf(status: "active" | "dissolved" | "unknown"): string {
  if (status === "active") {
    return "Aktívna";
  }
  return status === "dissolved" ? "Zaniknutá" : "Nezistená";
}

/** The colour of a verdict badge: the same three tones the rail uses. */
export function verdictToneOf(verdict: IntegrityVerdict): "good" | "warn" | "bad" | "neutral" {
  switch (verdict) {
    case "verified":
    case "valid":
      return "good";
    case "notice":
      return "warn";
    case "mismatch":
      return "bad";
    case "unverifiable":
    case "unavailable":
      return "neutral";
  }
}

export type CorrectionCheck = { ok: true; value: string | null } | { ok: false; message: string };

const SK_IC_DPH = /^SK\d{10}$/;
const CZ_NUMBER = /^CZ\d{8,10}$/;

/**
 * Her typed value, checked and normalised before it is stored (the same shapes the
 * integrity checks read). An empty DIČ, IČ DPH, address or VAT group clears the field;
 * the name may not be emptied.
 */
export function validateSubjectCorrection(field: CorrectableSubjectField, raw: string): CorrectionCheck {
  const trimmed = raw.trim();
  switch (field) {
    case "legalName":
      return trimmed.length > 0 ? { ok: true, value: trimmed } : { ok: false, message: "Názov nesmie byť prázdny." };
    case "address":
      return { ok: true, value: trimmed.length > 0 ? trimmed : null };
    case "dic": {
      if (trimmed.length === 0) {
        return { ok: true, value: null };
      }
      const compact = trimmed.toUpperCase().replace(/\s+/g, "");
      if (/^\d{10}$/.test(compact) || CZ_NUMBER.test(compact)) {
        return { ok: true, value: compact };
      }
      return {
        ok: false,
        message: "DIČ nemá platný tvar — slovenské má 10 číslic, české CZ a 8 až 10 číslic.",
      };
    }
    case "icDph": {
      if (trimmed.length === 0) {
        return { ok: true, value: null };
      }
      const compact = trimmed.toUpperCase().replace(/\s+/g, "");
      if (SK_IC_DPH.test(compact)) {
        return Number(compact.slice(2)) % 11 === 0
          ? { ok: true, value: compact }
          : { ok: false, message: "Slovenské IČ DPH musí byť deliteľné 11." };
      }
      if (CZ_NUMBER.test(compact)) {
        return { ok: true, value: compact };
      }
      return {
        ok: false,
        message: "IČ DPH nemá platný tvar — SK a 10 číslic, CZ a 8 až 10 číslic.",
      };
    }
    case "vatGroupId":
      try {
        return { ok: true, value: groupVatIdOf(trimmed) };
      } catch {
        return { ok: false, message: "IČ DPH skupiny nemá platný tvar." };
      }
  }
}
