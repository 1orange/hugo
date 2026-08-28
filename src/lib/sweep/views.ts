import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { listFilesForMonth } from "@/adapters/store/files";
import { getOpenMonthKey } from "@/adapters/store/months";
import { classifyFolder } from "@/modules/folder-taxonomy";
import { getSettings } from "@/adapters/store/settings";

export type CompanyListItem = {
  id: number;
  name: string;
  openMonth: string | null;
};

export type MonthDocumentGroup = {
  title: string;
  kind: "canonical" | "repair-candidate" | "unknown" | "vat-output";
  documents: Array<{
    driveFileId: string;
    name: string;
    deleted: boolean;
  }>;
};

export function listCompanySummaries(): CompanyListItem[] {
  return listCompanies().map((company) => ({
    id: company.id,
    name: company.name,
    openMonth: getOpenMonthKey(company.id),
  }));
}

export function buildMonthView(
  companyId: number,
  monthKey: string,
): {
  companyName: string;
  monthKey: string;
  groups: MonthDocumentGroup[];
} | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const settings = getSettings();
  const files = listFilesForMonth(companyId, monthKey);
  const groups = new Map<string, MonthDocumentGroup>();

  for (const file of files) {
    if (file.deleted) {
      continue;
    }

    if (file.folderSlot === null) {
      const key = "__vat__";
      const existing = groups.get(key) ?? {
        title: "VAT outputs (read-only)",
        kind: "vat-output" as const,
        documents: [],
      };
      existing.documents.push({
        driveFileId: file.driveFileId,
        name: file.name,
        deleted: file.deleted,
      });
      groups.set(key, existing);
      continue;
    }

    const classification = classifyFolder(file.folderSlot, {
      canonicalFolderNames: settings.canonicalFolderNames,
    });
    const title =
      classification.kind === "canonical"
        ? classification.name
        : classification.kind === "repair-candidate"
          ? `${classification.observedName} → repair to ${classification.targetName}`
          : classification.name;
    const kind = classification.kind;
    const key = file.folderSlot;
    const existing = groups.get(key) ?? { title, kind, documents: [] };
    existing.documents.push({
      driveFileId: file.driveFileId,
      name: file.name,
      deleted: file.deleted,
    });
    groups.set(key, existing);
  }

  return {
    companyName: company.name,
    monthKey,
    groups: [...groups.values()],
  };
}
