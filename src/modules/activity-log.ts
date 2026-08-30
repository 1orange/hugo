import type { DomainEvent } from "./drive-tree";

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
  "Confirmed",
  "Exported",
] as const;

export const GLOBAL_EVENT_TYPES = [
  "DriveParentFolderIdChanged",
  "CanonicalFolderNamesChanged",
  "MovableFolderNamesChanged",
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
  FileDiscovered: "Document discovered",
  FileRenamedInDrive: "Document renamed in Drive",
  FileMovedByClient: "Document moved in Drive",
  FileDeleted: "Document deleted",
  FolderCreated: "Folder created",
  Renamed: "Folder renamed",
  MonthClosed: "Month closed",
  MonthReopened: "Month reopened",
  Moved: "Document moved",
  Extracted: "Fields extracted",
  Confirmed: "Document confirmed",
  Exported: "Month exported",
  DriveParentFolderIdChanged: "Drive parent folder changed",
  CanonicalFolderNamesChanged: "Canonical folder names changed",
  MovableFolderNamesChanged: "Movable folder names changed",
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
    case "Confirmed":
    case "Exported":
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
      const name = text(payload.name) ?? "document";
      const firstSeenAt = text(payload.firstSeenAt);
      return firstSeenAt
        ? `${name} first seen at ${firstSeenAt}`
        : `${name} discovered`;
    }
    case "FileRenamedInDrive": {
      const previousName = text(payload.previousName) ?? "?";
      const newName = text(payload.newName) ?? "?";
      return `Renamed "${previousName}" to "${newName}" in Drive`;
    }
    case "FileMovedByClient": {
      const driveFileId = text(payload.driveFileId) ?? "document";
      const monthKey = text(payload.monthKey);
      return monthKey
        ? `${driveFileId} moved to month ${monthKey}`
        : `${driveFileId} moved in Drive`;
    }
    case "FileDeleted":
      return `Removed ${text(payload.driveFileId) ?? "document"}`;
    case "FolderCreated": {
      const name = text(payload.name) ?? "folder";
      return `Created folder "${name}"`;
    }
    case "Renamed": {
      const previousName = text(payload.previousName) ?? "?";
      const newName = text(payload.newName) ?? "?";
      if (payload.undone === true) {
        return `Undo: restored folder name from "${previousName}" to "${newName}"`;
      }
      return `Renamed folder from "${previousName}" to "${newName}"`;
    }
    case "MonthClosed":
      return `Closed month ${text(payload.monthKey) ?? "?"}`;
    case "MonthReopened":
      return `Reopened month ${text(payload.monthKey) ?? "?"}`;
    case "Moved": {
      const previousParent = text(payload.previousParent) ?? "?";
      const newParent = text(payload.newParent) ?? "?";
      const name = text(payload.name) ?? text(payload.driveFileId) ?? "document";
      return `Moved "${name}" from parent ${previousParent} to ${newParent}`;
    }
    case "DriveParentFolderIdChanged":
      return "Changed which Drive folder holds client companies";
    case "CanonicalFolderNamesChanged":
      return "Updated the canonical folder name list";
    case "MovableFolderNamesChanged":
      return "Updated which folders late arrivals may leave";
    case "Extracted":
      return `Extracted fields for ${text(payload.driveFileId) ?? "document"}`;
    case "Confirmed":
      return `Confirmed document ${text(payload.driveFileId) ?? "?"}`;
    case "Exported":
      return `Exported month ${text(payload.monthKey) ?? "?"}`;
    default:
      return type;
  }
}

export function formatActor(actor: string): string {
  if (actor === "system") {
    return "System";
  }
  if (actor === "user") {
    return "User";
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
