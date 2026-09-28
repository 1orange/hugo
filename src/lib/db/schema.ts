import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const companyProfiles = sqliteTable("company_profiles", {
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

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  driveParentFolderId: text("drive_parent_folder_id"),
  canonicalFolderNamesJson: text("canonical_folder_names_json").notNull(),
  movableFolderNamesJson: text("movable_folder_names_json"),
  lastSweepAt: text("last_sweep_at"),
  // Off by default: jumping to the next document after a decision is a real
  // speed win and a real surprise, so she opts in rather than discovers it.
  autoAdvanceAfterDecision: integer("auto_advance_after_decision", {
    mode: "boolean",
  })
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
});

export const months = sqliteTable("months", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  closedAt: text("closed_at"),
  openedAt: text("opened_at"),
});

export const files = sqliteTable("files", {
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
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
});

export const monthFolders = sqliteTable("month_folders", {
  driveFolderId: text("drive_folder_id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id").notNull(),
  canRename: integer("can_rename", { mode: "boolean" }).notNull().default(true),
});

export const documents = sqliteTable("documents", {
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
});

export const partners = sqliteTable("partners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

export const driveMutations = sqliteTable("drive_mutations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
