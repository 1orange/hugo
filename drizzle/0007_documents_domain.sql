DROP TABLE IF EXISTS `pairings`;--> statement-breakpoint
DROP TABLE IF EXISTS `payment_line_items`;--> statement-breakpoint
DROP TABLE IF EXISTS `payment_vat_recap`;--> statement-breakpoint
DROP TABLE IF EXISTS `receipt_manual_queue`;--> statement-breakpoint
DROP TABLE IF EXISTS `receipt_decode_jobs`;--> statement-breakpoint
DROP TABLE IF EXISTS `proofs`;--> statement-breakpoint
DROP TABLE IF EXISTS `payments`;--> statement-breakpoint
CREATE TABLE `documents` (
	`drive_file_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`folder_slot` text NOT NULL,
	`decision` text,
	`not_relevant_reason` text,
	`decided_at` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_failure_reason` text,
	`extracted_payload_json` text DEFAULT '{}' NOT NULL,
	`confirmed_payload_json` text DEFAULT '{}' NOT NULL,
	`note` text,
	`exported_at` text,
	`export_batch` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
