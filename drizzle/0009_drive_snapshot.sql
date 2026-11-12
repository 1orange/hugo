CREATE TABLE "drive_items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parents_json" text NOT NULL,
	"created_time" text NOT NULL,
	"mime_type" text NOT NULL,
	"can_rename" boolean,
	"can_move" boolean
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "drive_changes_token" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "drive_snapshot_at" text;