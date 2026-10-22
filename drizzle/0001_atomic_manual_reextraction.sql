ALTER TABLE "documents" ADD COLUMN "replacement_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "staged_extracted_payload_json" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "staged_extraction_status" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "staged_extraction_failure_reason" text;