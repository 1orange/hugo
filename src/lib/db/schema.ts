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
