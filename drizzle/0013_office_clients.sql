ALTER TABLE "subjects" ADD COLUMN "office_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "office_keeper" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "office_cooperation" text;