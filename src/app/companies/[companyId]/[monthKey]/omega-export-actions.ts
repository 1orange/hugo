"use server";

import { createCompanyRegister } from "@/adapters/company-register/create-company-register";
import { companyActionRefusal, type CompanyRefusal } from "@/lib/access/guard";
import {
  buildMonthOmegaExport,
  previewMonthOmegaExport,
  type MonthExportPreview,
} from "@/lib/omega-export/service";

/** The Omega export of a company the person may not see is refused, for the preview and the file alike (ADR 0023). */
export async function previewOmegaExportAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<{ ok: true; preview: MonthExportPreview } | CompanyRefusal> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  const register = createCompanyRegister();
  return { ok: true, preview: await previewMonthOmegaExport(input.companyId, input.monthKey, register) };
}

export async function downloadOmegaExportAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<{ ok: true; fileName: string; base64: string } | { ok: false; message: string }> {
  const refused = await companyActionRefusal(input.companyId);
  if (refused) {
    return refused;
  }

  try {
    const register = createCompanyRegister();
    const { bytes, preview } = await buildMonthOmegaExport({
      companyId: input.companyId,
      monthKey: input.monthKey,
      register,
    });
    return {
      ok: true,
      fileName: `omega-${input.monthKey}.txt`,
      base64: bytes.toString("base64"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export zlyhal.";
    return { ok: false, message };
  }
}
