import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const companyProfiles = pgTable("company_profiles", {
  companyId: integer("company_id")
    .primaryKey()
    .references(() => companies.id),
  country: text("country").notNull(),
  legalName: text("legal_name").notNull(),
  address: text("address").notNull(),
  ico: text("ico").notNull(),
  dic: text("dic").notNull(),
  icDph: text("ic_dph").notNull(),
  registerSource: text("register_source").notNull(),
  savedAt: text("saved_at").notNull(),
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  driveParentFolderId: text("drive_parent_folder_id"),
  canonicalFolderNamesJson: text("canonical_folder_names_json").notNull(),
  movableFolderNamesJson: text("movable_folder_names_json"),
  lastSweepAt: text("last_sweep_at"),
  // Off by default: jumping to the next document after a decision is a real
  // speed win and a real surprise, so she opts in rather than discovers it.
  autoAdvanceAfterDecision: boolean("auto_advance_after_decision")
    .notNull()
    .default(false),
  omegaT01EvidenceCode: text("omega_t01_evidence_code").notNull().default("OF"),
  omegaT01SeriesCode: text("omega_t01_series_code").notNull().default("OF"),
  omegaT01ReceivedEvidenceCode: text("omega_t01_received_evidence_code")
    .notNull()
    .default("DF"),
  omegaT01ReceivedSeriesCode: text("omega_t01_received_series_code")
    .notNull()
    .default("DF"),
  omegaT00EvidenceCode: text("omega_t00_evidence_code").notNull().default("IDk"),
  omegaT00SeriesCode: text("omega_t00_series_code").notNull().default("IDk"),
  omegaT00DocumentTypeCode: text("omega_t00_document_type_code")
    .notNull()
    .default("180"),
  omegaT00ForeignDocumentTypeCode: text("omega_t00_foreign_document_type_code")
    .notNull()
    .default("380"),
  // The Drive changes channel being watched (ADR 0020).
  driveWatchChannelId: text("drive_watch_channel_id"),
  driveWatchResourceId: text("drive_watch_resource_id"),
  driveWatchToken: text("drive_watch_token"),
  driveWatchExpiresAt: text("drive_watch_expires_at"),
});

export const months = pgTable("months", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  closedAt: text("closed_at"),
  openedAt: text("opened_at"),
});

export const files = pgTable("files", {
  driveFileId: text("drive_file_id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  folderSlot: text("folder_slot"),
  parentId: text("parent_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  driveCreatedTime: text("drive_created_time").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  deleted: boolean("deleted").notNull().default(false),
}, (table) => [index("files_company_month").on(table.companyId, table.monthKey)]);

export const events = pgTable("events", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  timestamp: text("timestamp").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [index("events_company").on(table.companyId, table.id)]);

export const monthFolders = pgTable("month_folders", {
  driveFolderId: text("drive_folder_id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id").notNull(),
  canRename: boolean("can_rename").notNull().default(true),
});

export const documents = pgTable("documents", {
  /**
   * The Drive file ID for a file's own document; `<file>#<eKasa UID>` for each
   * further receipt found in the same file (one document per receipt).
   */
  id: text("id").primaryKey(),
  driveFileId: text("drive_file_id")
    .notNull()
    .references(() => files.driveFileId),
  /** Set on the extra receipts of a multi-receipt file; null otherwise. */
  receiptUid: text("receipt_uid"),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  folderSlot: text("folder_slot").notNull(),
  decision: text("decision"),
  notRelevantReason: text("not_relevant_reason"),
  decidedAt: text("decided_at"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionFailureReason: text("extraction_failure_reason"),
  /** EXTRACTION_PIPELINE_VERSION of the last attempt; null before versions were kept. */
  extractionPipelineVersion: integer("extraction_pipeline_version"),
  extractedPayloadJson: text("extracted_payload_json").notNull().default("{}"),
  confirmedPayloadJson: text("confirmed_payload_json").notNull().default("{}"),
  note: text("note"),
  exportedAt: text("exported_at"),
  exportBatch: text("export_batch"),
  exportNumber: text("export_number"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("documents_company_export_number").on(table.companyId, table.exportNumber),
  index("documents_drive_file_id").on(table.driveFileId),
  // NULLs are distinct: a file's own document has no receipt UID.
  uniqueIndex("documents_file_receipt").on(table.driveFileId, table.receiptUid),
  index("documents_company_month").on(table.companyId, table.monthKey),
]);

export const partners = pgTable("partners", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  country: text("country").notNull(),
  ico: text("ico").notNull(),
  legalName: text("legal_name").notNull(),
  street: text("street").notNull().default(""),
  psc: text("psc").notNull().default(""),
  city: text("city").notNull().default(""),
  dic: text("dic").notNull().default(""),
  icDph: text("ic_dph").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("partners_company_country_ico").on(table.companyId, table.country, table.ico)]);

export const driveMutations = pgTable("drive_mutations", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  kind: text("kind").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  previousParent: text("previous_parent").notNull(),
  previousName: text("previous_name").notNull(),
  newParent: text("new_parent").notNull(),
  newName: text("new_name").notNull(),
  // Written before Drive is touched, so a crash mid-mutation still leaves a row
  // describing exactly what was attempted. "pending" therefore means unknown,
  // not "not started".
  status: text("status").notNull().default("pending"),
  intendedAt: text("intended_at").notNull(),
  appliedAt: text("applied_at"),
  failureMessage: text("failure_message"),
  undoneAt: text("undone_at"),
});
