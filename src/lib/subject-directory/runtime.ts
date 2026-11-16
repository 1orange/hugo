import type { CompanyRegister } from "@/adapters/company-register/port";
import { createCompanyRegister } from "@/adapters/company-register/create-company-register";
import { createVatRegister } from "@/adapters/vat-register/create-vat-register";
import { getSettings } from "@/adapters/store/settings";
import { createLookupRateLimiter, lookupsPerMinute, type LookupRateLimiter } from "./rate-limit";
import { createLookupLock } from "./lookup-lock";
import type { DirectoryDeps } from "./service";

let limiter: LookupRateLimiter | null = null;

/** This process's register lookup rate: the worker and a web replica each keep their own. */
function processLookupLimiter(env: NodeJS.ProcessEnv): LookupRateLimiter {
  limiter ??= createLookupRateLimiter({ perMinute: lookupsPerMinute(env) });
  return limiter;
}

/**
 * The directory's dependencies for a caller in this process: the given register, one
 * lock per key across the replicas, and the process's lookup rate (ADR 0022).
 */
export function directoryDepsFor(input: {
  register: CompanyRegister;
  refreshDays: number;
  now: () => string;
  env?: NodeJS.ProcessEnv;
}): DirectoryDeps {
  const env = input.env ?? process.env;
  return {
    register: input.register,
    vat: createVatRegister(env),
    lock: createLookupLock(),
    limiter: processLookupLimiter(env),
    refreshDays: input.refreshDays,
    now: input.now,
  };
}

/** The worker's directory: the configured register, one lock per key, the process's lookup rate. */
export async function workerDirectoryDeps(env: NodeJS.ProcessEnv = process.env): Promise<DirectoryDeps> {
  const settings = await getSettings();
  return directoryDepsFor({
    register: createCompanyRegister(env),
    refreshDays: settings.subjectRefreshDays,
    now: () => new Date().toISOString(),
    env,
  });
}
