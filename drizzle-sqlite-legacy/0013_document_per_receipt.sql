-- One document per receipt: a scan of several receipts yields several documents
-- for one Drive file. Existing documents keep their Drive file ID as their ID.
CREATE TABLE `documents_new` (
	`id` text PRIMARY KEY NOT NULL,
	`drive_file_id` text NOT NULL,
	`receipt_uid` text,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`folder_slot` text NOT NULL,
	`decision` text,
	`not_relevant_reason` text,
	`decided_at` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_failure_reason` text,
	`extraction_pipeline_version` integer,
	`extracted_payload_json` text DEFAULT '{}' NOT NULL,
	`confirmed_payload_json` text DEFAULT '{}' NOT NULL,
	`note` text,
	`exported_at` text,
	`export_batch` text,
	`export_number` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `documents_new` (
	`id`, `drive_file_id`, `receipt_uid`, `company_id`, `month_key`, `folder_slot`, `decision`,
	`not_relevant_reason`, `decided_at`, `extraction_status`, `extraction_failure_reason`,
	`extraction_pipeline_version`, `extracted_payload_json`, `confirmed_payload_json`, `note`,
	`exported_at`, `export_batch`, `export_number`, `created_at`
)
SELECT
	`drive_file_id`, `drive_file_id`, NULL, `company_id`, `month_key`, `folder_slot`, `decision`,
	`not_relevant_reason`, `decided_at`, `extraction_status`, `extraction_failure_reason`,
	`extraction_pipeline_version`, `extracted_payload_json`, `confirmed_payload_json`, `note`,
	`exported_at`, `export_batch`, `export_number`, `created_at`
FROM `documents`;
--> statement-breakpoint
DROP TABLE `documents`;
--> statement-breakpoint
ALTER TABLE `documents_new` RENAME TO `documents`;
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_company_export_number` ON `documents` (`company_id`,`export_number`);
--> statement-breakpoint
CREATE INDEX `documents_drive_file_id` ON `documents` (`drive_file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_file_receipt` ON `documents` (`drive_file_id`,`receipt_uid`);
