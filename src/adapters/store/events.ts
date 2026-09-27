import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import type { DomainEvent } from "@/modules/drive-tree";
import type {
  GlobalEventType,
  UserCompanyEventType,
} from "@/modules/activity-log";

export function appendEvents(
  timestamp: string,
  domainEvents: DomainEvent[],
  resolveCompanyId: (event: DomainEvent) => number | null,
): void {
  const db = getDb();
  for (const event of domainEvents) {
    db.insert(events)
      .values({
        timestamp,
        companyId: resolveCompanyId(event),
        actor: "system",
        type: event.type,
        payloadJson: JSON.stringify(event),
      })
      .run();
  }
}

/**
 * `type` is narrowed to the vocabulary so a new slice cannot emit a type the
 * activity log has no label for — that renders as a bare identifier in history,
 * which the label test alone cannot catch.
 */
export function appendUserEvent(
  timestamp: string,
  companyId: number,
  type: UserCompanyEventType,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  db.insert(events)
    .values({
      timestamp,
      companyId,
      actor: "user",
      type,
      payloadJson: JSON.stringify(payload),
    })
    .run();
}

export function appendGlobalUserEvent(
  timestamp: string,
  type: GlobalEventType,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  db.insert(events)
    .values({
      timestamp,
      companyId: null,
      actor: "user",
      type,
      payloadJson: JSON.stringify(payload),
    })
    .run();
}

export function appendCompanySystemEvent(
  timestamp: string,
  companyId: number,
  type: UserCompanyEventType,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  db.insert(events)
    .values({
      timestamp,
      companyId,
      actor: "system",
      type,
      payloadJson: JSON.stringify(payload),
    })
    .run();
}
