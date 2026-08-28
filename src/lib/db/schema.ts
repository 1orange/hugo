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
