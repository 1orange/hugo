import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { DomainEvent } from "@/modules/drive-tree";
import type {
  GlobalEventType,
  UserCompanyEventType,
} from "@/modules/activity-log";

export async function appendEvents(
  timestamp: string,
  domainEvents: DomainEvent[],
  resolveCompanyId: (event: DomainEvent) => number | null,
): Promise<void> {
  if (domainEvents.length === 0) {
    return;
  }
  const db = getDb();
  // One statement keeps the sweep's events in their order, with no gap for another writer.
  await db.insert(events).values(
    domainEvents.map((event) => ({
      timestamp,
      companyId: resolveCompanyId(event),
      actor: "system",
      type: event.type,
      payloadJson: JSON.stringify(event),
    })),
  );
}

/**
 * `type` is narrowed to the vocabulary so a new slice cannot emit a type the
 * activity log has no label for — that renders as a bare identifier in history,
 * which the label test alone cannot catch.
 */
export async function appendUserEvent(
  timestamp: string,
  companyId: number,
  type: UserCompanyEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(events).values({
    timestamp,
    companyId,
    actor: "user",
    type,
    payloadJson: JSON.stringify(payload),
  });
}

export async function appendGlobalUserEvent(
  timestamp: string,
  type: GlobalEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(events).values({
    timestamp,
    companyId: null,
    actor: "user",
    type,
    payloadJson: JSON.stringify(payload),
  });
}

export async function appendCompanySystemEvent(
  timestamp: string,
  companyId: number,
  type: UserCompanyEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(events).values({
    timestamp,
    companyId,
    actor: "system",
    type,
    payloadJson: JSON.stringify(payload),
  });
}
