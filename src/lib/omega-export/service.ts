import type { CompanyRegister } from "@/adapters/company-register/port";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import {
  listDocumentsForCompany,
  listDocumentsForMonth,
  listExportNumbersForCompany,
  markDocumentsExported,
  setDocumentExportNumber,
  type DocumentRow,
} from "@/adapters/store/documents";
import { getFileByDriveId } from "@/adapters/store/files";
import { upsertPartner } from "@/adapters/store/partners";
import type { SubjectRow } from "@/adapters/store/subjects";
import { getSettings, type SettingsRow } from "@/adapters/store/settings";
import { appendUserEvent } from "@/adapters/store/events";
import type { CompanyCountry } from "@/modules/company-profile";
import { homeCurrencyForCountry } from "@/modules/company-profile";
import { mergeDocumentFields, type FieldProvenance } from "@/modules/document-fields";
import {
  mergeDocumentFieldsWithDirectory,
  type DirectoryFactsCache,
} from "@/lib/subject-directory/directory-facts";
import { directoryDepsFor } from "@/lib/subject-directory/runtime";
import {
  subjectForExport,
  type DirectoryDeps,
} from "@/lib/subject-directory/service";
import { subjectCountryOf } from "@/modules/subject-directory";
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
import { receiptUidOfDocument } from "@/modules/receipt-identity";
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
      // Registers write "street, PSČ city"; the comma is not the street's.
      street: match[1]!.trim().replace(/,$/, ""),
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

/**
 * A partner value from the subject directory (ADR 0022). A value she typed on the document
 * itself stands; otherwise the subject's value (a register answer, or her correction of the
 * subject) is exported, and the document's value only where the subject has none.
 */
function partnerValue(input: {
  documentValue: string;
  provenance: FieldProvenance;
  subjectValue: string | null | undefined;
}): string {
  const typed = input.documentValue.trim();
  if (input.provenance === "confirmed" && typed.length > 0) {
    return typed;
  }
  return (input.subjectValue ?? "").trim() || typed;
}

async function resolvePartner(input: {
  companyId: number;
  country: CompanyCountry;
  name: string;
  ico: string;
  dic: string;
  icDph: string;
  provenance: { name: FieldProvenance; dic: FieldProvenance; icDph: FieldProvenance };
  /** The counterparty's subject in the directory, when it is known or was looked up (ADR 0019, ADR 0022). */
  subject: SubjectRow | null;
  now: string;
}): Promise<OmegaPartnerRecord> {
  const normalizedIco = input.ico.replace(/\s/g, "");
  const subject = input.subject;
  const legalName = partnerValue({
    documentValue: input.name,
    provenance: input.provenance.name,
    subjectValue: subject?.legalName,
  });
  const dic = partnerValue({
    documentValue: input.dic,
    provenance: input.provenance.dic,
    subjectValue: subject?.dic,
  });
  const icDph = partnerValue({
    documentValue: input.icDph,
    provenance: input.provenance.icDph,
    subjectValue: subject?.icDph,
  });
  const { street, psc, city } = splitAddress(subject?.address ?? "");

  if (normalizedIco.length > 0) {
    await upsertPartner({
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

async function assignMissingExportNumbers(input: {
  companyId: number;
  monthKey: string;
  documents: DocumentRow[];
}): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  const existing = await listExportNumbersForCompany(input.companyId);
  let sequence = nextExportSequence(existing, input.monthKey);

  for (const document of input.documents) {
    if (document.exportNumber) {
      numbers.set(document.id, document.exportNumber);
      continue;
    }
    const exportNumber = formatExportNumber(input.monthKey, sequence);
    sequence += 1;
    await setDocumentExportNumber(document.id, exportNumber);
    numbers.set(document.id, exportNumber);
    existing.push(exportNumber);
  }

  return numbers;
}

function invoiceDocType(folderSlot: string): 0 | 14 {
  return folderSlot.startsWith("01 ") ? 0 : 14;
}

function buildVatRecap(merged: ReturnType<typeof mergeDocumentFields>) {
  return [...merged.fields.vatRecap];
}

function buildInvoiceDraft(input: {
  document: DocumentRow;
  exportNumber: string;
  counterparty: OmegaPartnerRecord;
  merged: ReturnType<typeof mergeDocumentFields>;
}): OmegaInvoiceDraft | { heldBack: true; reason: string } {
  const variableSymbol =
    input.merged.fields.variableSymbol.trim() || input.merged.fields.documentNumber.trim();
  if (variableSymbol.length === 0) {
    return { heldBack: true, reason: "Chýba VS alebo číslo dokladu." };
  }

  const vatRecap = buildVatRecap(input.merged);
  const totalCents =
    input.merged.fields.amountCents ??
    vatRecap.reduce((sum, row) => sum + row.baseCents + row.vatCents, 0);

  return {
    documentId: input.document.id,
    exportNumber: input.exportNumber,
    docType: invoiceDocType(input.document.folderSlot),
    variableSymbol,
    issueDate: input.merged.fields.issueDateRaw,
    dueDate: input.merged.fields.dueDateRaw,
    taxableSupplyDate:
      input.merged.fields.taxableSupplyDateRaw || input.merged.fields.issueDateRaw,
    currency: input.merged.fields.currency || "EUR",
    counterparty: input.counterparty,
    vatRecap,
    totalCents,
  };
}

function buildReceiptDraft(input: {
  document: DocumentRow;
  exportNumber: string;
  counterparty: OmegaPartnerRecord;
  settings: SettingsRow;
  homeCurrency: string;
  merged: ReturnType<typeof mergeDocumentFields>;
}): OmegaReceiptDraft | { heldBack: true; reason: string } {
  const externalNumber =
    input.merged.fields.receiptNumber.trim() || input.merged.fields.documentNumber.trim();
  if (externalNumber.length === 0) {
    return { heldBack: true, reason: "Chýba číslo bločku alebo dokladu." };
  }

  const vatRecap = buildVatRecap(input.merged);
  const totalCents =
    input.merged.fields.amountCents ??
    vatRecap.reduce((sum, row) => sum + row.baseCents + row.vatCents, 0);

  const issueRaw =
    input.merged.fields.issueDateRaw.trim() ||
    formatDateOnly(input.merged.fields.receiptTimestampRaw);
  if (issueRaw.length === 0) {
    return { heldBack: true, reason: "Chýba dátum dokladu." };
  }

  const primaryDate = formatDateOnly(issueRaw);
  const foreignCurrency =
    input.merged.fields.currency.length > 0 &&
    input.merged.fields.currency !== input.homeCurrency;

  const docTypeCode = foreignCurrency
    ? Number(input.settings.omegaT00ForeignDocumentTypeCode) || 380
    : Number(input.settings.omegaT00DocumentTypeCode) || 180;

  return {
    documentId: input.document.id,
    exportNumber: input.exportNumber,
    docTypeCode,
    evidenceCode: input.settings.omegaT00EvidenceCode,
    seriesCode: input.settings.omegaT00SeriesCode,
    externalNumber,
    issueDate: primaryDate,
    receiptDate: formatDateOnly(input.merged.fields.receiptTimestampRaw) || primaryDate,
    dueDate: input.merged.fields.dueDateRaw.trim() || primaryDate,
    taxableSupplyDate:
      input.merged.fields.taxableSupplyDateRaw.trim() || primaryDate,
    transactionDate: primaryDate,
    currency: input.merged.fields.currency || input.homeCurrency,
    foreignCurrency,
    counterparty: input.counterparty,
    vatRecap,
    totalCents,
  };
}

export type MonthExportPreviewItem = {
  documentId: string;
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
  /** The register unknown or stale subjects are looked up in, through the directory. Null: the directory is only read. */
  register?: CompanyRegister | null;
  /** The directory's dependencies, when the caller has them (tests, the worker). Overrides `register`. */
  directory?: DirectoryDeps | null;
  now?: string;
  persist?: boolean;
}): Promise<{
  preview: MonthExportPreview;
  bytes: Buffer;
}> {
  const now = input.now ?? new Date().toISOString();
  const [settings, profile, monthDocuments, companyDocuments] = await Promise.all([
    getSettings(),
    getCompanyProfile(input.companyId),
    listDocumentsForMonth(input.companyId, input.monthKey),
    listDocumentsForCompany(input.companyId),
  ]);
  const profileCountry: CompanyCountry = profile?.country ?? "SK";
  const homeCurrency = homeCurrencyForCountry(profileCountry);
  const register = input.register ?? null;
  const directory: DirectoryDeps | null =
    input.directory !== undefined
      ? input.directory
      : register
        ? directoryDepsFor({ register, refreshDays: settings.subjectRefreshDays, now: () => now })
        : null;

  const confirmed = monthDocuments.filter((document) => document.decision === "confirmed");

  const exportNumbers = await assignMissingExportNumbers({
    companyId: input.companyId,
    monthKey: input.monthKey,
    documents: confirmed,
  });

  const directoryCache: DirectoryFactsCache = new Map();
  const invoices: OmegaInvoiceDraft[] = [];
  const receipts: OmegaReceiptDraft[] = [];
  const partners: OmegaPartnerRecord[] = [];
  const preHeldBack: Array<{ documentId: string; reason: string }> = [];
  const sectionByDocument = new Map<string, "T01" | "T00">();
  const documentsById = new Map(confirmed.map((document) => [document.id, document]));

  // The same receipt must reach Omega once, even when it sits in two files
  // (2026-08-17_094259 and _094358 both carry O-5EA6…D41C).
  const exportedByUid = new Map<string, DocumentRow>();
  for (const document of companyDocuments) {
    const uid = receiptUidOfDocument(document);
    if (uid && document.exportedAt && !exportedByUid.has(uid)) {
      exportedByUid.set(uid, document);
    }
  }
  const includedByUid = new Map<string, DocumentRow>();

  for (const document of confirmed) {
    const uid = receiptUidOfDocument(document);
    if (uid) {
      const earlier = [exportedByUid.get(uid), includedByUid.get(uid)].find(
        (other) => other && other.id !== document.id,
      );
      if (earlier) {
        preHeldBack.push({
          documentId: document.id,
          reason: `Rovnaký bloček (${uid}) je už v exporte ako ${
            (await getFileByDriveId(earlier.driveFileId))?.name ?? earlier.driveFileId
          }${earlier.exportNumber ? ` (${earlier.exportNumber})` : ""}.`,
        });
        continue;
      }
      includedByUid.set(uid, document);
    }

    const extracted = parseExtractedPayload(document.extractedPayloadJson);
    const confirmedPayload = parseConfirmedPayload(document.confirmedPayloadJson);
    const section = resolveExportSection({
      extracted,
      confirmed: confirmedPayload,
      folderSlot: document.folderSlot,
    });
    sectionByDocument.set(document.id, section);

    // The export carries the effective values: what the directory fills counts as the document's (ADR 0022).
    const { merged } = await mergeDocumentFieldsWithDirectory(extracted, confirmedPayload, {
      folderSlot: document.folderSlot,
      profile: profile ?? null,
      extractionPipelineVersion: document.extractionPipelineVersion,
    }, directoryCache);

    const counterpartySource =
      section === "T01" && document.folderSlot.startsWith("01 ")
        ? {
            name: merged.fields.customerName,
            ico: merged.fields.customerIco,
            dic: merged.fields.customerDic,
            icDph: merged.fields.customerIcDph,
            provenance: {
              name: merged.provenance.customerName,
              dic: merged.provenance.customerDic,
              icDph: merged.provenance.customerIcDph,
            },
          }
        : {
            name: supplierNameForDocument({
              extracted,
              mergedSupplierName: merged.fields.supplierName,
            }),
            ico: merged.fields.ico,
            dic: merged.fields.dic,
            icDph: merged.fields.icDph,
            provenance: {
              name: merged.provenance.supplierName,
              dic: merged.provenance.dic,
              icDph: merged.provenance.icDph,
            },
          };

    // The directory first: a known, fresh counterparty is read with no register call; an unknown or
    // stale one is looked up once and recorded there (ADR 0022). A register outage costs nothing known.
    const counterpartyParty = {
      name: counterpartySource.name,
      ico: counterpartySource.ico,
      dic: counterpartySource.dic,
      icDph: counterpartySource.icDph,
    };
    const subject = await subjectForExport(
      counterpartyParty,
      subjectCountryOf(counterpartyParty) ?? profileCountry,
      directory,
      { documentId: document.id },
    );

    const counterparty = await resolvePartner({
      companyId: input.companyId,
      country: profileCountry,
      name: counterpartySource.name,
      ico: counterpartySource.ico,
      dic: counterpartySource.dic,
      icDph: counterpartySource.icDph,
      provenance: counterpartySource.provenance,
      subject,
      now,
    });
    partners.push(counterparty);

    const exportNumber = exportNumbers.get(document.id)!;

    if (section === "T01") {
      const draft = buildInvoiceDraft({
        document,
        exportNumber,
        counterparty,
        merged,
      });
      if ("heldBack" in draft) {
        preHeldBack.push({ documentId: document.id, reason: draft.reason });
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
      merged,
    });
    if ("heldBack" in draft) {
      preHeldBack.push({ documentId: document.id, reason: draft.reason });
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
      documentId: row.documentId,
      label: row.variableSymbol,
    })),
    ...plan.includedReceipts.map((row) => ({
      documentId: row.documentId,
      label: row.externalNumber,
    })),
  ];

  const fileNames = new Map<string, string>();
  for (const row of [...includedRows, ...heldBack]) {
    const driveFileId = documentsById.get(row.documentId)?.driveFileId ?? row.documentId;
    if (!fileNames.has(driveFileId)) {
      fileNames.set(driveFileId, (await getFileByDriveId(driveFileId))?.name ?? driveFileId);
    }
  }
  const fileOf = (documentId: string) => {
    const driveFileId = documentsById.get(documentId)?.driveFileId ?? documentId;
    return { driveFileId, fileName: fileNames.get(driveFileId) ?? driveFileId };
  };

  const preview: MonthExportPreview = {
    exportBatch,
    included: includedRows.map((row) => ({
      documentId: row.documentId,
      ...fileOf(row.documentId),
      exportNumber: exportNumbers.get(row.documentId) ?? null,
      label: row.label,
      section: sectionByDocument.get(row.documentId) ?? "T00",
    })),
    heldBack: heldBack.map((row) => ({
      documentId: row.documentId,
      ...fileOf(row.documentId),
      exportNumber: exportNumbers.get(row.documentId) ?? null,
      label: exportNumbers.get(row.documentId) ?? "—",
      reason: row.reason,
      section: sectionByDocument.get(row.documentId) ?? "T00",
    })),
  };

  const bytes = buildOmegaFileBytes({
    ...exportInput,
    invoices: plan.includedInvoices,
    receipts: plan.includedReceipts,
  });

  if (input.persist !== false) {
    await markDocumentsExported({
      documentIds: includedRows.map((row) => row.documentId),
      exportedAt: now,
      exportBatch,
    });
    await appendUserEvent(now, input.companyId, "Exported", {
      monthKey: input.monthKey,
      exportBatch,
      included: preview.included,
      heldBack: preview.heldBack.map(({ documentId, driveFileId, reason, exportNumber, section }) => ({
        documentId,
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
