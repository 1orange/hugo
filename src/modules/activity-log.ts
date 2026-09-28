import type { DomainEvent } from "./drive-tree";
import { formatDateTime } from "./format-sk";

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
  "Extracted",
  "EkasaUidEntered",
  "Confirmed",
  "Exported",
  "CompanyProfileSaved",
  "ExportSectionChanged",
] as const;

export const GLOBAL_EVENT_TYPES = [
  "DriveParentFolderIdChanged",
  "CanonicalFolderNamesChanged",
  "MovableFolderNamesChanged",
  "AutoAdvanceChanged",
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
  Extracted: "Údaje spracované",
  EkasaUidEntered: "Zadaný UID eBločku",
  Confirmed: "Doklad potvrdený",
  Exported: "Mesiac exportovaný",
  CompanyProfileSaved: "Profil firmy uložený",
  ExportSectionChanged: "Zmenená sekcia exportu",
  DriveParentFolderIdChanged: "Zmenený nadradený priečinok Drive",
  CanonicalFolderNamesChanged: "Zmenený zoznam názvov priečinkov",
  MovableFolderNamesChanged: "Zmenené presunuteľné priečinky",
  AutoAdvanceChanged: "Zmenený automatický posun na ďalší doklad",
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
      const previousParent = text(payload.previousParent) ?? "?";
      const newParent = text(payload.newParent) ?? "?";
      const name = text(payload.name) ?? text(payload.driveFileId) ?? "doklad";
      return `Presunuté „${name}“ z priečinka ${previousParent} do ${newParent}`;
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
