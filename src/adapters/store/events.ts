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
