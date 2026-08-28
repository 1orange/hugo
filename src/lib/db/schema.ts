import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  driveParentFolderId: text("drive_parent_folder_id"),
  canonicalFolderNamesJson: text("canonical_folder_names_json").notNull(),
  movableFolderNamesJson: text("movable_folder_names_json"),
  lastSweepAt: text("last_sweep_at"),
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

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  source: text("source").notNull(),
  blocekFileId: text("blocek_file_id").references(() => files.driveFileId).unique(),
  amountCents: integer("amount_cents"),
  amountLiteral: text("amount_literal"),
  currency: text("currency").notNull().default("EUR"),
  receiptAt: text("receipt_at"),
  receiptTimestampRaw: text("receipt_timestamp_raw"),
  ekasaUid: text("ekasa_uid"),
  ekasaOkp: text("ekasa_okp"),
  ekasaPayload: text("ekasa_payload"),
  supplierName: text("supplier_name"),
  dic: text("dic"),
  ico: text("ico"),
  icDph: text("ic_dph"),
  kp: text("kp"),
  receiptNumber: text("receipt_number"),
  recapBaseCents: integer("recap_base_cents"),
  recapBaseLiteral: text("recap_base_literal"),
  recapVatCents: integer("recap_vat_cents"),
  recapVatLiteral: text("recap_vat_literal"),
  decodeStatus: text("decode_status").notNull().default("complete"),
  confirmedAt: text("confirmed_at"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const proofs = sqliteTable("proofs", {
  driveFileId: text("drive_file_id")
    .primaryKey()
    .references(() => files.driveFileId),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const pairings = sqliteTable("pairings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => payments.id),
  proofDriveFileId: text("proof_drive_file_id")
    .notNull()
    .references(() => proofs.driveFileId),
  createdBy: text("created_by").notNull(),
  confidence: text("confidence"),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
  unpairedAt: text("unpaired_at"),
});

export const paymentLineItems = sqliteTable("payment_line_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => payments.id),
  sortOrder: integer("sort_order").notNull(),
  name: text("name").notNull(),
  vatRateLiteral: text("vat_rate_literal").notNull(),
  quantityLiteral: text("quantity_literal").notNull(),
  unitPriceLiteral: text("unit_price_literal").notNull(),
  lineTotalLiteral: text("line_total_literal").notNull(),
  lineTotalCents: integer("line_total_cents").notNull(),
});

export const paymentVatRecap = sqliteTable("payment_vat_recap", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id")
    .notNull()
    .references(() => payments.id),
  rateLiteral: text("rate_literal").notNull(),
  baseLiteral: text("base_literal").notNull(),
  baseCents: integer("base_cents").notNull(),
  vatLiteral: text("vat_literal").notNull(),
  vatCents: integer("vat_cents").notNull(),
});

export const receiptManualQueue = sqliteTable("receipt_manual_queue", {
  driveFileId: text("drive_file_id")
    .primaryKey()
    .references(() => files.driveFileId),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const receiptDecodeJobs = sqliteTable("receipt_decode_jobs", {
  driveFileId: text("drive_file_id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  monthKey: text("month_key").notNull(),
  status: text("status").notNull(),
  failureReason: text("failure_reason"),
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
