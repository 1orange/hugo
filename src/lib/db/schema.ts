import { boolean, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const companies = pgTable("companies", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  /** The accountant's folder it sits in on the shared drive ("Eva"); null for a company at the root. */
  groupName: text("group_name"),
  /** In the archive group: a former client that gets no new months. */
  archived: boolean("archived").notNull().default(false),
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
  // Register data older than this is refreshed on the next sighting (ADR 0022).
  subjectRefreshDays: integer("subject_refresh_days").notNull().default(30),
  // Where the sweep last read Drive's change log, and when it last listed every file (ADR 0003).
  driveChangesToken: text("drive_changes_token"),
  driveSnapshotAt: text("drive_snapshot_at"),
});

/**
 * Every item the service account sees in Drive, as of the last sweep: the
 * listing the sweep diffs, kept so a sweep reads only Drive's changes since.
 */
export const driveItems = pgTable("drive_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentsJson: text("parents_json").notNull(),
  createdTime: text("created_time").notNull(),
  mimeType: text("mime_type").notNull(),
  canRename: boolean("can_rename"),
  canMove: boolean("can_move"),
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
  // The last sweep that changed the row; a sweep writes only the rows it changed.
  lastSeenAt: text("last_seen_at").notNull(),
  /**
   * When the file arrived in the month it is in: moved there from another
   * month; null when it has been there since it was first seen. A file that
   * arrived after its month was closed is a late arrival (ADR 0005, amended 2026-11-12).
   */
  arrivedAt: text("arrived_at"),
  /** Drive's `canMoveItemWithinDrive` at the last sweep (ADR 0006). */
  canMove: boolean("can_move").notNull().default(true),
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
  /** A manual replacement is written here until the complete file can be promoted atomically. */
  replacementPending: boolean("replacement_pending").notNull().default(false),
  /** True only for extra document rows first discovered during that attempt. */
  replacementCreated: boolean("replacement_created").notNull().default(false),
  stagedExtractedPayloadJson: text("staged_extracted_payload_json"),
  stagedExtractionStatus: text("staged_extraction_status"),
  stagedExtractionFailureReason: text("staged_extraction_failure_reason"),
  confirmedPayloadJson: text("confirmed_payload_json").notNull().default("{}"),
  /**
   * The worker's integrity verdict for each party, with the identity it was
   * judged for (ADR 0018 amendment, ADR 0022). Null until the worker has checked
   * the document; pages read it and never call a register.
   */
  partyIntegrityJson: text("party_integrity_json"),
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

/**
 * The late-arrivals log (ADR 0005, ADR 0006): a file that arrived in a month
 * after it was closed. One row per file, kept whatever happens to it, so that
 * nothing landed late is lost by navigating away. `pending` until it is moved
 * into the open month, ignored, or resolved (it left the closed month, or the
 * month was reopened).
 */
export const lateArrivals = pgTable("late_arrivals", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  driveFileId: text("drive_file_id").notNull().unique(),
  /** The closed month it arrived in, its folder slot and folder. */
  sourceMonthKey: text("source_month_key").notNull(),
  folderSlot: text("folder_slot").notNull(),
  sourceParentId: text("source_parent_id").notNull(),
  arrivedAt: text("arrived_at").notNull(),
  detectedAt: text("detected_at").notNull(),
  /** pending | moved | ignored | resolved. */
  status: text("status").notNull().default("pending"),
  statusChangedAt: text("status_changed_at"),
  /** Where it was moved, and the mutation that moved it (undo reads it). */
  targetMonthKey: text("target_month_key"),
  mutationId: integer("mutation_id"),
}, (table) => [index("late_arrivals_company").on(table.companyId, table.status)]);

/**
 * What the last sweep found wrong with a company's Drive layout (*Štruktúra
 * Drive*, PRD 0004). Recomputed on every sweep and replaced wholesale, so this
 * is a picture of Drive, not a to-do list: a fix in Drive clears its row.
 */
export const structureDeviations = pgTable("structure_deviations", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  path: text("path").notNull(),
  monthKey: text("month_key"),
  driveFolderId: text("drive_folder_id"),
  detailsJson: text("details_json").notNull(),
  detectedAt: text("detected_at").notNull(),
}, (table) => [index("structure_deviations_company").on(table.companyId)]);

/**
 * The shared subject directory (ADR 0022): one row per subject across every
 * client company. Keyed by (country, IČO); a foreign subject without a Slovak
 * or Czech IČO by its normalised VAT ID. Register values are kept with the
 * source of each (`register`, `vies`, `manual`, `profile`).
 */
export const subjects = pgTable("subjects", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  /** SK, CZ, or foreign. */
  country: text("country").notNull(),
  ico: text("ico"),
  /** Normalised: SK + IČ DPH, or CZ + DIČ for a Czech subject; the key of a foreign one. */
  vatId: text("vat_id"),
  legalName: text("legal_name"),
  formerNamesJson: text("former_names_json").notNull().default("[]"),
  dic: text("dic"),
  icDph: text("ic_dph"),
  /** VAT-group membership, where VIES says so (slice 14). */
  vatGroupId: text("vat_group_id"),
  address: text("address"),
  /** active, dissolved, or unknown (never looked up, or not in the register). */
  registerStatus: text("register_status").notNull().default("unknown"),
  /** VIES status of the IČ DPH (slice 14); null until VIES was asked. */
  viesStatus: text("vies_status"),
  /** Per field: where its value came from. */
  sourcesJson: text("sources_json").notNull().default("{}"),
  /** Fields an accountant corrected: a refresh never overwrites them. */
  manualFieldsJson: text("manual_fields_json").notNull().default("[]"),
  /** Disagreements a refresh or a profile found, for the directory screen. */
  findingsJson: text("findings_json").notNull().default("[]"),
  /**
   * The client company this subject is: its profile is this record (ADR 0022, amended
   * 2026-11-16). At most one subject per company.
   */
  linkedCompanyId: integer("linked_company_id").references(() => companies.id),
  /** Client subjects only: where the profile's identity was last taken from ("rpo+ruz", "ares", "manual"…). */
  profileRegisterSource: text("profile_register_source"),
  /** Client subjects only: when her profile was last saved. */
  profileSavedAt: text("profile_saved_at"),
  /** When the register (or VIES) last answered; null while never. */
  verifiedAt: text("verified_at"),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("subjects_country_ico")
    .on(table.country, table.ico)
    .where(sql`${table.ico} IS NOT NULL`),
  uniqueIndex("subjects_vat_id_without_ico")
    .on(table.vatId)
    .where(sql`${table.ico} IS NULL`),
  index("subjects_vat_id").on(table.vatId),
  // A company has at most one subject: its profile (ADR 0022, amended 2026-11-16).
  uniqueIndex("subjects_linked_company_once")
    .on(table.linkedCompanyId)
    .where(sql`${table.linkedCompanyId} IS NOT NULL`),
]);

/** The names a subject is printed under on documents, with how often (ADR 0022). */
export const subjectAliases = pgTable("subject_aliases", {
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjects.id),
  /** Lowercase, without diacritics or punctuation: the key of an alias lookup. */
  normalizedName: text("normalized_name").notNull(),
  displayName: text("display_name").notNull(),
  count: integer("count").notNull().default(0),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.subjectId, table.normalizedName] }),
  index("subject_aliases_name").on(table.normalizedName),
]);

/**
 * Which document each sighting of an alias came from. An alias counts once per
 * document, so checking the same document again does not inflate its count (ADR 0022).
 */
export const subjectAliasSightings = pgTable("subject_alias_sightings", {
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjects.id),
  normalizedName: text("normalized_name").notNull(),
  documentId: text("document_id").notNull(),
  sightedAt: text("sighted_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.subjectId, table.normalizedName, table.documentId] }),
]);
