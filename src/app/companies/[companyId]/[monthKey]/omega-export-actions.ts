"use server";

import { createCompanyRegister } from "@/adapters/company-register/create-company-register";
import {
  buildMonthOmegaExport,
  previewMonthOmegaExport,
  type MonthExportPreview,
} from "@/lib/omega-export/service";

export async function previewOmegaExportAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<MonthExportPreview> {
  const register = createCompanyRegister();
  return previewMonthOmegaExport(input.companyId, input.monthKey, register);
}

export async function downloadOmegaExportAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<{ ok: true; fileName: string; base64: string } | { ok: false; message: string }> {
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
