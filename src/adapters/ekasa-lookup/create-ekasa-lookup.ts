import { createE2eFakeEkasaLookup } from "@/adapters/ekasa-lookup/e2e-fake-ekasa-lookup";
import { createHttpEkasaLookup } from "@/adapters/ekasa-lookup/http-ekasa-lookup";
import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";

export function createEkasaLookup(
  env: NodeJS.ProcessEnv = process.env,
): EkasaLookup {
  if (env.EKASA_LOOKUP === "fake" || env.DRIVE_CLIENT === "fake") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "EKASA_LOOKUP=fake must never be used in production: it replaces real eKasa lookup with fixture data",
      );
    }
    return createE2eFakeEkasaLookup();
  }

  return createHttpEkasaLookup();
}
