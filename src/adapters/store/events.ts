import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import type { DomainEvent } from "@/modules/drive-tree";

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

export function appendUserEvent(
  timestamp: string,
  companyId: number,
  type: string,
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
  type: string,
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
