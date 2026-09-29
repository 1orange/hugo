/**
 * What this process does (ADR 0021). `web` serves pages and queues work;
 * `worker` reads documents and sweeps Drive; `all` is both in one process —
 * `npm run dev` and e2e, where the fake Drive lives in one process's memory.
 */
export type HugoRole = "web" | "worker" | "all";

export function hugoRole(env: NodeJS.ProcessEnv = process.env): HugoRole {
  const raw = env.HUGO_ROLE?.trim().toLowerCase();
  if (raw === "web" || raw === "worker" || raw === "all") {
    return raw;
  }
  return env.NODE_ENV === "production" ? "web" : "all";
}
