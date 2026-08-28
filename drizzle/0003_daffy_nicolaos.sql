CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`source` text NOT NULL,
	`blocek_file_id` text NOT NULL,
	`amount_cents` integer,
	`amount_literal` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`receipt_at` text,
	`receipt_timestamp_raw` text,
	`ekasa_uid` text,
	`ekasa_payload` text,
	`decode_status` text DEFAULT 'complete' NOT NULL,
	`confirmed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocek_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_blocek_file_id_unique` ON `payments` (`blocek_file_id`);--> statement-breakpoint
CREATE TABLE `receipt_decode_jobs` (
	`drive_file_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receipt_manual_queue` (
	`drive_file_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
