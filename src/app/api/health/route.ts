import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { redis } from "@/lib/redis/connection";

export const dynamic = "force-dynamic";

/** Readiness for Kubernetes and Docker: the database and Redis answer. Public, and says nothing else. */
export async function GET(): Promise<NextResponse> {
  const [database, queue] = await Promise.allSettled([getDb().execute(sql`SELECT 1`), redis().ping()]);
  const ok = database.status === "fulfilled" && queue.status === "fulfilled";
  return NextResponse.json(
    { database: database.status === "fulfilled", redis: queue.status === "fulfilled" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
