import type { CompanyRegister } from "@/adapters/company-register/port";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import {
  listDocumentsForMonth,
  listExportNumbersForCompany,
  markDocumentsExported,
  setDocumentExportNumber,
  type DocumentRow,
} from "@/adapters/store/documents";
import { getFileByDriveId } from "@/adapters/store/files";
import { upsertPartner } from "@/adapters/store/partners";
import { getSettings } from "@/adapters/store/settings";
import { appendUserEvent } from "@/adapters/store/events";
import type { CompanyCountry } from "@/modules/company-profile";
import { homeCurrencyForCountry } from "@/modules/company-profile";
import { mergeDocumentFields } from "@/modules/document-fields";
import {
  parseConfirmedPayload,
  parseExtractedPayload,
  isEkasaPayload,
} from "@/modules/document-payload";
import {
  formatExportNumber,
  nextExportSequence,
} from "@/modules/export-numbering";
import { organizationNameFromOpd } from "@/modules/ekasa-lookup-mapping";
import { resolveExportSection } from "@/modules/omega-export-section";
import {
  buildOmegaFileBytes,
  planOmegaExport,
  type OmegaExportInput,
  type OmegaInvoiceDraft,
  type OmegaPartnerRecord,
  type OmegaReceiptDraft,
} from "@/modules/omega-file";

function partnerKey(country: string, ico: string, fallbackName: string): string {
  const normalized = ico.replace(/\s/g, "");
  if (normalized.length > 0) {
    return `${country}:${normalized}`;
  }
  return `${country}:name:${fallbackName.trim()}`;
}

function splitAddress(address: string): { street: string; psc: string; city: string } {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { street: "", psc: "", city: "" };
  }
  const match = /^(.*)\s+(\d{3}\s?\d{2})\s+(.+)$/.exec(trimmed);
  if (match) {
    return {
      street: match[1]!.trim(),
      psc: match[2]!.trim(),
      city: match[3]!.trim(),
    };
  }
  return { street: trimmed, psc: "", city: "" };
}

function formatDateOnly(raw: string): string {
  const trimmed = raw.trim();
  const datePart = trimmed.split(/\s+/)[0] ?? trimmed;
  return datePart;
}

function supplierNameForDocument(input: {
  extracted: ReturnType<typeof parseExtractedPayload>;
  mergedSupplierName: string;
}): string {
  if (isEkasaPayload(input.extracted) && input.extracted.opdResponse) {
    const fromOrg = organizationNameFromOpd(input.extracted.opdResponse);
    if (fromOrg) {
      return fromOrg;
    }
  }
  return input.mergedSupplierName.trim();
}

async function resolvePartner(input: {
  companyId: number;
  country: CompanyCountry;
  name: string;
  ico: string;
  dic: string;
  icDph: string;
  register: CompanyRegister | null;
  now: string;
}): Promise<OmegaPartnerRecord> {
  const normalizedIco = input.ico.replace(/\s/g, "");
  let street = "";
  let psc = "";
  let city = "";
  let legalName = input.name.trim();
  let dic = input.dic.trim();
  let icDph = input.icDph.trim();

  if (normalizedIco.length > 0 && input.register) {
    const lookup = await input.register.lookupByIco(normalizedIco, input.country);
    if (lookup) {
      legalName = lookup.legalName.trim() || legalName;
      dic = lookup.dic.trim() || dic;
      const parts = splitAddress(lookup.address);
      street = parts.street;
      psc = parts.psc;
      city = parts.city;
    }
  }

  if (normalizedIco.length > 0) {
    upsertPartner({
      companyId: input.companyId,
      country: input.country,
      ico: normalizedIco,
      legalName: legalName || input.name.trim(),
      street,
      psc,
      city,
      dic,
      icDph,
      updatedAt: input.now,
    });
  }

  return {
    partnerKey: partnerKey(input.country, normalizedIco, legalName || input.name),
    country: input.country,
    name: legalName || input.name.trim(),
    street,
    psc,
    city,
    ico: normalizedIco,
    dic,
    icDph,
  };
}

function assignMissingExportNumbers(input: {
  companyId: number;
  monthKey: string;
  documents: DocumentRow[];
}): Map<string, string> {
  const numbers = new Map<string, string>();
  const existing = listExportNumbersForCompany(input.companyId);
  let sequence = nextExportSequence(existing, input.monthKey);

  for (const document of input.documents) {
    if (document.exportNumber) {
      numbers.set(document.driveFileId, document.exportNumber);
      continue;
    }
    const exportNumber = formatExportNumber(input.monthKey, sequence);
    sequence += 1;
    setDocumentExportNumber(document.driveFileId, exportNumber);
    numbers.set(document.driveFileId, exportNumber);
    existing.push(exportNumber);
  }

  return numbers;
}

function invoiceDocType(folderSlot: string): 0 | 14 {
  return folderSlot.startsWith("01 ") ? 0 : 14;
}

function buildVatRecap(merged: ReturnType<typeof mergeDocumentFields>) {
  const vatRecap = [...merged.fields.vatRecap];
  if (vatRecap.length === 0 && merged.fields.recapBaseCents !== null) {
    vatRecap.push({
      rateLiteral: "23",
      baseLiteral: merged.fields.recapBaseLiteral,
      baseCents: merged.fields.recapBaseCents ?? 0,
      vatLiteral: merged.fields.recapVatLiteral,
      vatCents: merged.fields.recapVatCents ?? 0,
    });
  }
  return vatRecap;
}

function buildInvoiceDraft(input: {
  document: DocumentRow;
  exportNumber: string;
  counterparty: OmegaPartnerRecord;
}): OmegaInvoiceDraft | { heldBack: true; reason: string } {
  const merged = mergeDocumentFields(
    parseExtractedPayload(input.document.extractedPayloadJson),
    parseConfirmedPayload(input.document.confirmedPayloadJson),
    { folderSlot: input.document.folderSlot },
  );

  const variableSymbol =
    merged.fields.variableSymbol.trim() || merged.fields.documentNumber.trim();
  if (variableSymbol.length === 0) {
    return { heldBack: true, reason: "Chýba VS alebo číslo dokladu." };
  }

  const vatRecap = buildVatRecap(merged);
  const totalCents =
    merged.fields.amountCents ??
    vatRecap.reduce((sum, row) => sum + row.baseCents + row.vatCents, 0);

  return {
    driveFileId: input.document.driveFileId,
    exportNumber: input.exportNumber,
    docType: invoiceDocType(input.document.folderSlot),
    variableSymbol,
    issueDate: merged.fields.issueDateRaw,
    dueDate: merged.fields.dueDateRaw,
    taxableSupplyDate: merged.fields.taxableSupplyDateRaw || merged.fields.issueDateRaw,
    currency: merged.fields.currency || "EUR",
    counterparty: input.counterparty,
    vatRecap,
    totalCents,
  };
}

function buildReceiptDraft(input: {
  document: DocumentRow;
  exportNumber: string;
  counterparty: OmegaPartnerRecord;
  settings: ReturnType<typeof getSettings>;
  homeCurrency: string;
}): OmegaReceiptDraft | { heldBack: true; reason: string } {
  const merged = mergeDocumentFields(
    parseExtractedPayload(input.document.extractedPayloadJson),
    parseConfirmedPayload(input.document.confirmedPayloadJson),
    { folderSlot: input.document.folderSlot },
  );

  const externalNumber =
    merged.fields.receiptNumber.trim() ||
    merged.fields.documentNumber.trim();
  if (externalNumber.length === 0) {
    return { heldBack: true, reason: "Chýba číslo bločku alebo dokladu." };
  }

  const vatRecap = buildVatRecap(merged);
  const totalCents =
    merged.fields.amountCents ??
    vatRecap.reduce((sum, row) => sum + row.baseCents + row.vatCents, 0);

  const issueRaw =
    merged.fields.issueDateRaw.trim() ||
    formatDateOnly(merged.fields.receiptTimestampRaw);
  if (issueRaw.length === 0) {
    return { heldBack: true, reason: "Chýba dátum dokladu." };
  }

  const primaryDate = formatDateOnly(issueRaw);
  const foreignCurrency =
    merged.fields.currency.length > 0 &&
    merged.fields.currency !== input.homeCurrency;

  const docTypeCode = foreignCurrency
    ? Number(input.settings.omegaT00ForeignDocumentTypeCode) || 380
    : Number(input.settings.omegaT00DocumentTypeCode) || 180;

  return {
    driveFileId: input.document.driveFileId,
    exportNumber: input.exportNumber,
    docTypeCode,
    evidenceCode: input.settings.omegaT00EvidenceCode,
    seriesCode: input.settings.omegaT00SeriesCode,
    externalNumber,
    issueDate: primaryDate,
    receiptDate: formatDateOnly(merged.fields.receiptTimestampRaw) || primaryDate,
    dueDate: merged.fields.dueDateRaw.trim() || primaryDate,
    taxableSupplyDate:
      merged.fields.taxableSupplyDateRaw.trim() || primaryDate,
    transactionDate: primaryDate,
    currency: merged.fields.currency || input.homeCurrency,
    foreignCurrency,
    counterparty: input.counterparty,
    vatRecap,
    totalCents,
  };
}

export type MonthExportPreviewItem = {
  driveFileId: string;
  fileName: string;
  exportNumber: string | null;
  label: string;
  section: "T01" | "T00";
};

export type MonthExportPreview = {
  included: MonthExportPreviewItem[];
  heldBack: Array<MonthExportPreviewItem & { reason: string }>;
  exportBatch: string;
};

export async function buildMonthOmegaExport(input: {
  companyId: number;
  monthKey: string;
  register?: CompanyRegister | null;
  now?: string;
  persist?: boolean;
}): Promise<{
  preview: MonthExportPreview;
  bytes: Buffer;
}> {
  const now = input.now ?? new Date().toISOString();
  const settings = getSettings();
  const profile = getCompanyProfile(input.companyId);
  const profileCountry: CompanyCountry = profile?.country ?? "SK";
  const homeCurrency = homeCurrencyForCountry(profileCountry);
  const register = input.register ?? null;

  const confirmed = listDocumentsForMonth(input.companyId, input.monthKey).filter(
    (document) => document.decision === "confirmed",
  );

  const exportNumbers = assignMissingExportNumbers({
    companyId: input.companyId,
    monthKey: input.monthKey,
    documents: confirmed,
  });

  const invoices: OmegaInvoiceDraft[] = [];
  const receipts: OmegaReceiptDraft[] = [];
  const partners: OmegaPartnerRecord[] = [];
  const preHeldBack: Array<{ driveFileId: string; reason: string }> = [];
  const sectionByFile = new Map<string, "T01" | "T00">();

  for (const document of confirmed) {
    const extracted = parseExtractedPayload(document.extractedPayloadJson);
    const confirmedPayload = parseConfirmedPayload(document.confirmedPayloadJson);
    const section = resolveExportSection({
      extracted,
      confirmed: confirmedPayload,
      folderSlot: document.folderSlot,
    });
    sectionByFile.set(document.driveFileId, section);

    const merged = mergeDocumentFields(extracted, confirmedPayload, {
      folderSlot: document.folderSlot,
      profile: profile ?? null,
    });

    const counterpartySource =
      section === "T01" && document.folderSlot.startsWith("01 ")
        ? {
            name: merged.fields.customerName,
            ico: merged.fields.customerIco,
            dic: merged.fields.customerDic,
            icDph: merged.fields.customerIcDph,
          }
        : {
            name: supplierNameForDocument({
              extracted,
              mergedSupplierName: merged.fields.supplierName,
            }),
            ico: merged.fields.ico,
            dic: merged.fields.dic,
            icDph: merged.fields.icDph,
          };

    const counterparty = await resolvePartner({
      companyId: input.companyId,
      country: profileCountry,
      name: counterpartySource.name,
      ico: counterpartySource.ico,
      dic: counterpartySource.dic,
      icDph: counterpartySource.icDph,
      register,
      now,
    });
    partners.push(counterparty);

    const exportNumber = exportNumbers.get(document.driveFileId)!;

    if (section === "T01") {
      const draft = buildInvoiceDraft({
        document,
        exportNumber,
        counterparty,
      });
      if ("heldBack" in draft) {
        preHeldBack.push({ driveFileId: document.driveFileId, reason: draft.reason });
        continue;
      }
      invoices.push(draft);
      continue;
    }

    const draft = buildReceiptDraft({
      document,
      exportNumber,
      counterparty,
      settings,
      homeCurrency,
    });
    if ("heldBack" in draft) {
      preHeldBack.push({ driveFileId: document.driveFileId, reason: draft.reason });
      continue;
    }
    receipts.push(draft);
  }

  const omegaSettings = {
    t01EvidenceCode: settings.omegaT01EvidenceCode,
    t01SeriesCode: settings.omegaT01SeriesCode,
    t01ReceivedEvidenceCode: settings.omegaT01ReceivedEvidenceCode,
    t01ReceivedSeriesCode: settings.omegaT01ReceivedSeriesCode,
    t00EvidenceCode: settings.omegaT00EvidenceCode,
    t00SeriesCode: settings.omegaT00SeriesCode,
    t00DocumentTypeCode: Number(settings.omegaT00DocumentTypeCode) || 180,
    t00ForeignDocumentTypeCode:
      Number(settings.omegaT00ForeignDocumentTypeCode) || 380,
  };

  const exportInput: OmegaExportInput = {
    monthKey: input.monthKey,
    settings: omegaSettings,
    invoices,
    receipts,
    partners,
  };

  const plan = planOmegaExport(exportInput);
  const heldBack = [...preHeldBack, ...plan.heldBack];
  const exportBatch = `${input.monthKey}-${now}`;

  const includedRows = [
    ...plan.includedInvoices.map((row) => ({
      driveFileId: row.driveFileId,
      label: row.variableSymbol,
    })),
    ...plan.includedReceipts.map((row) => ({
      driveFileId: row.driveFileId,
      label: row.externalNumber,
    })),
  ];

  const preview: MonthExportPreview = {
    exportBatch,
    included: includedRows.map((row) => ({
      driveFileId: row.driveFileId,
      exportNumber: exportNumbers.get(row.driveFileId) ?? null,
      fileName: getFileByDriveId(row.driveFileId)?.name ?? row.driveFileId,
      label: row.label,
      section: sectionByFile.get(row.driveFileId) ?? "T00",
    })),
    heldBack: heldBack.map((row) => ({
      driveFileId: row.driveFileId,
      exportNumber: exportNumbers.get(row.driveFileId) ?? null,
      fileName: getFileByDriveId(row.driveFileId)?.name ?? row.driveFileId,
      label: exportNumbers.get(row.driveFileId) ?? "—",
      reason: row.reason,
      section: sectionByFile.get(row.driveFileId) ?? "T00",
    })),
  };

  const bytes = buildOmegaFileBytes({
    ...exportInput,
    invoices: plan.includedInvoices,
    receipts: plan.includedReceipts,
  });

  if (input.persist !== false) {
    markDocumentsExported({
      driveFileIds: includedRows.map((row) => row.driveFileId),
      exportedAt: now,
      exportBatch,
    });
    appendUserEvent(now, input.companyId, "Exported", {
      monthKey: input.monthKey,
      exportBatch,
      included: preview.included,
      heldBack: preview.heldBack.map(({ driveFileId, reason, exportNumber, section }) => ({
        driveFileId,
        reason,
        exportNumber,
        section,
      })),
    });
  }

  return { preview, bytes };
}

export async function previewMonthOmegaExport(
  companyId: number,
  monthKey: string,
  register?: CompanyRegister | null,
): Promise<MonthExportPreview> {
  const result = await buildMonthOmegaExport({
    companyId,
    monthKey,
    register,
    persist: false,
  });
  return result.preview;
}
