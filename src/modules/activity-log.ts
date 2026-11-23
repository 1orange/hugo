import type { DomainEvent } from "./drive-tree";
import { formatDateTime } from "./format-sk";
import type { SubjectField } from "./subject-directory";
import { correctableFieldLabel } from "./subject-screen";
import { OFFICE_FIELD_LABELS, PROFILE_FIELD_LABELS, type FieldKey, type OfficeField } from "./client-sheet";

/**
 * Single source of truth for the append-only event vocabulary (ADR 0012).
 * Labels and payload summaries live here; do not duplicate this list elsewhere.
 */

export const DOMAIN_EVENT_TYPES = [
  "FileDiscovered",
  "FileRenamedInDrive",
  "FileMovedByClient",
  "FileDeleted",
] as const satisfies ReadonlyArray<DomainEvent["type"]>;

export const USER_COMPANY_EVENT_TYPES = [
  "FolderCreated",
  "Renamed",
  "MonthClosed",
  "MonthReopened",
  "Moved",
  "LateArrivalIgnored",
  "Extracted",
  "EkasaUidEntered",
  "Confirmed",
  "Exported",
  "CompanyProfileSaved",
  "ImportedFromClientSheet",
  "ExportSectionChanged",
  "PartiesSwapped",
  "PartyTakenFromRegister",
  "PartyTakenFromProfile",
  "AdvanceSettlementOverridden",
  "ReextractionRequested",
  "ReextractionCompleted",
  "ReextractionFailed",
] as const;

export const GLOBAL_EVENT_TYPES = [
  "DriveParentFolderIdChanged",
  "CanonicalFolderNamesChanged",
  "MovableFolderNamesChanged",
  "AutoAdvanceChanged",
  "SubjectCorrected",
  "SubjectImportedFromClientSheet",
] as const;

export const COMPANY_SCOPED_EVENT_TYPES = [
  ...DOMAIN_EVENT_TYPES,
  ...USER_COMPANY_EVENT_TYPES,
] as const;

export const ALL_EVENT_TYPES = [
  ...COMPANY_SCOPED_EVENT_TYPES,
  ...GLOBAL_EVENT_TYPES,
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export type UserCompanyEventType = (typeof USER_COMPANY_EVENT_TYPES)[number];
export type GlobalEventType = (typeof GLOBAL_EVENT_TYPES)[number];
export type KnownEventType = (typeof ALL_EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<KnownEventType, string> = {
  FileDiscovered: "Nájdený doklad",
  FileRenamedInDrive: "Doklad premenovaný v Drive",
  FileMovedByClient: "Doklad presunutý v Drive",
  FileDeleted: "Doklad odstránený",
  FolderCreated: "Priečinok vytvorený",
  Renamed: "Priečinok premenovaný",
  MonthClosed: "Mesiac uzavretý",
  MonthReopened: "Mesiac znovu otvorený",
  Moved: "Doklad presunutý",
  LateArrivalIgnored: "Neskorý doklad ignorovaný",
  Extracted: "Údaje spracované",
  EkasaUidEntered: "Zadaný UID eBločku",
  Confirmed: "Doklad potvrdený",
  Exported: "Mesiac exportovaný",
  CompanyProfileSaved: "Profil firmy uložený",
  ImportedFromClientSheet: "Profil firmy doplnený z klientskeho hárku",
  ExportSectionChanged: "Zmenená sekcia exportu",
  PartiesSwapped: "Strany dokladu vymenené",
  PartyTakenFromRegister: "Údaje strany prevzaté z registra",
  PartyTakenFromProfile: "Údaje strany prevzaté z profilu",
  AdvanceSettlementOverridden: "Vyúčtovanie zálohy určené ručne",
  ReextractionRequested: "Doklad znova načítaný",
  ReextractionCompleted: "Doklad znova načítaný — údaje nahradené",
  ReextractionFailed: "Opätovné načítanie dokladu zlyhalo",
  DriveParentFolderIdChanged: "Zmenený nadradený priečinok Drive",
  CanonicalFolderNamesChanged: "Zmenený zoznam názvov priečinkov",
  MovableFolderNamesChanged: "Zmenené presunuteľné priečinky",
  AutoAdvanceChanged: "Zmenený automatický posun na ďalší doklad",
  SubjectCorrected: "Subjekt v adresári opravený",
  SubjectImportedFromClientSheet: "Subjekt v adresári doplnený z klientskeho hárku",
};

export type StoredActivityEvent = {
  id: number;
  timestamp: string;
  companyId: number | null;
  actor: string;
  type: string;
  payloadJson: string;
};

export type ActivityEntry = {
  id: number;
  timestamp: string;
  actorLabel: string;
  type: string;
  typeLabel: string;
  summary: string;
  monthKey: string | null;
};

function readPayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ponytail: corrupt rows still render with the raw type label
  }
  return {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Field keys stored in a payload, shown with their Slovak labels; unknown keys are dropped. */
function fieldLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((key): key is FieldKey => typeof key === "string" && key in PROFILE_FIELD_LABELS)
    .map((key) => PROFILE_FIELD_LABELS[key]);
}

/** The office fields a client-sheet write set (Vedie, Spolupráca, the office-client flag). */
function officeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((key): key is OfficeField => typeof key === "string" && key in OFFICE_FIELD_LABELS)
    .map((key) => OFFICE_FIELD_LABELS[key]);
}

export function eventMonthKey(
  type: string,
  payload: Record<string, unknown>,
): string | null {
  switch (type) {
    case "FileDiscovered":
    case "FileMovedByClient":
    case "MonthClosed":
    case "MonthReopened":
    case "Moved":
    case "Extracted":
    case "EkasaUidEntered":
    case "Confirmed":
    case "Exported":
    case "ExportSectionChanged":
    case "PartiesSwapped":
    case "PartyTakenFromRegister":
    case "PartyTakenFromProfile":
    case "AdvanceSettlementOverridden":
    case "ReextractionRequested":
    case "ReextractionCompleted":
    case "ReextractionFailed":
      return text(payload.monthKey);
    default:
      return null;
  }
}

export function summarizeEventPayload(
  type: string,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "FileDiscovered": {
      const name = text(payload.name) ?? "doklad";
      const firstSeenAt = text(payload.firstSeenAt);
      return firstSeenAt
        ? `${name} — prvýkrát videný ${formatDateTime(firstSeenAt)}`
        : `${name} — nájdený`;
    }
    case "FileRenamedInDrive": {
      const previousName = text(payload.previousName) ?? "?";
      const newName = text(payload.newName) ?? "?";
      return `Premenované „${previousName}“ na „${newName}“ v Drive`;
    }
    case "FileMovedByClient": {
      const driveFileId = text(payload.driveFileId) ?? "doklad";
      const monthKey = text(payload.monthKey);
      return monthKey
        ? `${driveFileId} presunutý do mesiaca ${monthKey}`
        : `${driveFileId} presunutý v Drive`;
    }
    case "FileDeleted":
      return `Odstránený ${text(payload.driveFileId) ?? "doklad"}`;
    case "FolderCreated": {
      const name = text(payload.name) ?? "priečinok";
      return `Vytvorený priečinok „${name}“`;
    }
    case "Renamed": {
      const previousName = text(payload.previousName) ?? "?";
      const newName = text(payload.newName) ?? "?";
      if (payload.undone === true) {
        return `Vrátené: názov priečinka obnovený z „${previousName}“ na „${newName}“`;
      }
      return `Priečinok premenovaný z „${previousName}“ na „${newName}“`;
    }
    case "MonthClosed":
      return `Uzavretý mesiac ${text(payload.monthKey) ?? "?"}`;
    case "MonthReopened":
      return `Znovu otvorený mesiac ${text(payload.monthKey) ?? "?"}`;
    case "Moved": {
      const name = text(payload.name) ?? text(payload.driveFileId) ?? "doklad";
      const fromMonthKey = text(payload.fromMonthKey);
      const toMonthKey = text(payload.toMonthKey);
      if (fromMonthKey && toMonthKey) {
        const folder = text(payload.folderSlot);
        const where = folder ? ` (${folder})` : "";
        return payload.undone === true
          ? `Vrátené: „${name}“ z ${fromMonthKey} späť do ${toMonthKey}${where}`
          : `Neskorý doklad „${name}“ presunutý z ${fromMonthKey} do ${toMonthKey}${where}`;
      }
      const previousParent = text(payload.previousParent) ?? "?";
      const newParent = text(payload.newParent) ?? "?";
      return `Presunuté „${name}“ z priečinka ${previousParent} do ${newParent}`;
    }
    case "LateArrivalIgnored": {
      const name = text(payload.driveFileId) ?? "doklad";
      return payload.ignored === false
        ? `Neskorý doklad ${name} vrátený do zoznamu`
        : `Neskorý doklad ${name} ignorovaný`;
    }
    case "DriveParentFolderIdChanged":
      return "Zmenený priečinok Drive, v ktorom sú firmy klientov";
    case "CanonicalFolderNamesChanged":
      return "Aktualizovaný zoznam kanonických názvov priečinkov";
    case "MovableFolderNamesChanged":
      return "Aktualizované priečinky, z ktorých sa smú presúvať neskoré doklady";
    case "AutoAdvanceChanged":
      return payload.next === true
        ? "Po rozhodnutí sa automaticky prejde na ďalší doklad"
        : "Po rozhodnutí sa zostáva na tom istom doklade";
    case "SubjectCorrected": {
      const subjectName = text(payload.subjectName) ?? "subjekt";
      const field = text(payload.field);
      const label = field ? correctableFieldLabel(field as SubjectField) : "pole";
      return `${subjectName} — ${label}: „${text(payload.previous) ?? "—"}“ → „${text(payload.next) ?? "—"}“`;
    }
    case "Extracted": {
      const driveFileId = text(payload.driveFileId) ?? "doklad";
      const source = text(payload.source);
      if (source === "lookup") {
        return `Spracované údaje pre ${driveFileId} (Finančná správa)`;
      }
      if (source === "text-layer") {
        return `Spracované údaje pre ${driveFileId} (text PDF)`;
      }
      if (source === "model") {
        return `Spracované údaje pre ${driveFileId} (model)`;
      }
      if (source === "ocr") {
        return `Spracované údaje pre ${driveFileId} (OCR)`;
      }
      if (source === "isdoc") {
        return `Spracované údaje pre ${driveFileId} (ISDOC)`;
      }
      if (source === "mol") {
        return `Spracované údaje pre ${driveFileId} (XML MOL)`;
      }
      return `Spracované údaje pre ${driveFileId}`;
    }
    case "EkasaUidEntered": {
      const uid = text(payload.uid) ?? "?";
      if (payload.found === true) {
        return `UID ${uid} — údaje načítané z Finančnej správy`;
      }
      return `UID ${uid} — v eKase nenájdený`;
    }
    case "Confirmed":
      return `Potvrdený doklad ${text(payload.driveFileId) ?? "?"}`;
    case "ReextractionRequested":
      return `Znova načítať doklad ${text(payload.driveFileId) ?? "?"}`;
    case "ReextractionCompleted":
      return `Znova načítané údaje pre ${text(payload.driveFileId) ?? "?"}`;
    case "ReextractionFailed":
      return `Znova načítanie ${text(payload.driveFileId) ?? "?"} zlyhalo`;
    case "Exported": {
      const included = Array.isArray(payload.included) ? payload.included.length : null;
      const heldBack = Array.isArray(payload.heldBack) ? payload.heldBack.length : null;
      const month = text(payload.monthKey) ?? "?";
      if (included !== null && heldBack !== null) {
        return `Export mesiaca ${month}: ${included} v súbore, ${heldBack} zadržaných`;
      }
      return `Exportovaný mesiac ${month}`;
    }
    case "CompanyProfileSaved": {
      const legalName = text(payload.legalName) ?? "firma";
      const ico = text(payload.ico);
      return ico ? `${legalName} (IČO ${ico})` : legalName;
    }
    case "ImportedFromClientSheet": {
      const legalName = text(payload.legalName) ?? "firma";
      const written = [...fieldLabels(payload.fields), ...officeLabels(payload.office)];
      const overwritten = fieldLabels(payload.overwritten);
      const base = `${legalName} — z klientskeho hárku: ${written.join(", ") || "bez zmien"}`;
      return overwritten.length > 0 ? `${base}; prepísané uložené hodnoty: ${overwritten.join(", ")}` : base;
    }
    case "SubjectImportedFromClientSheet": {
      const legalName = text(payload.legalName) ?? text(payload.ico) ?? "subjekt";
      const written = [...fieldLabels(payload.fields), ...officeLabels(payload.office)];
      const overwritten = fieldLabels(payload.overwritten);
      const base = `${legalName} — z klientskeho hárku: ${written.join(", ") || "bez zmien"}`;
      return overwritten.length > 0 ? `${base}; prepísané uložené hodnoty: ${overwritten.join(", ")}` : base;
    }
    case "PartiesSwapped":
      return `Vymenené strany dokladu ${text(payload.driveFileId) ?? "?"}`;
    case "PartyTakenFromRegister":
      return `${text(payload.driveFileId) ?? "doklad"} → ${payload.side === "customer" ? "odberateľ" : "dodávateľ"} z registra`;
    case "PartyTakenFromProfile":
      return `${text(payload.driveFileId) ?? "doklad"} → ${payload.side === "customer" ? "odberateľ" : "dodávateľ"} z profilu`;
    case "AdvanceSettlementOverridden": {
      const driveFileId = text(payload.driveFileId) ?? "doklad";
      return payload.settled === true
        ? `${driveFileId} → vyúčtovanie zálohy`
        : `${driveFileId} → nie je vyúčtovanie zálohy`;
    }
    case "ExportSectionChanged": {
      const driveFileId = text(payload.driveFileId) ?? "doklad";
      const next = text(payload.next);
      if (next === "T01") {
        return `${driveFileId} → Fakturácia (T01)`;
      }
      if (next === "T00") {
        return `${driveFileId} → EUD (T00)`;
      }
      return `${driveFileId} → automaticky podľa typu`;
    }
    default:
      return type;
  }
}

export function formatActor(actor: string): string {
  if (actor === "system") {
    return "Systém";
  }
  if (actor === "user") {
    return "Ja";
  }
  return actor;
}

export function eventTypeLabel(type: string): string {
  return (EVENT_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

export function formatActivityEntry(event: StoredActivityEvent): ActivityEntry {
  const payload = readPayload(event.payloadJson);
  return {
    id: event.id,
    timestamp: event.timestamp,
    actorLabel: formatActor(event.actor),
    type: event.type,
    typeLabel: eventTypeLabel(event.type),
    summary: summarizeEventPayload(event.type, payload),
    monthKey: eventMonthKey(event.type, payload),
  };
}
