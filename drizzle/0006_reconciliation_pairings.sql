PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__payments_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`source` text NOT NULL,
	`blocek_file_id` text,
	`amount_cents` integer,
	`amount_literal` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`receipt_at` text,
	`receipt_timestamp_raw` text,
	`ekasa_uid` text,
	`ekasa_okp` text,
	`ekasa_payload` text,
	`supplier_name` text,
	`dic` text,
	`ico` text,
	`ic_dph` text,
	`kp` text,
	`receipt_number` text,
	`recap_base_cents` integer,
	`recap_base_literal` text,
	`recap_vat_cents` integer,
	`recap_vat_literal` text,
	`decode_status` text DEFAULT 'complete' NOT NULL,
	`confirmed_at` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocek_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__payments_new`(
	`id`, `company_id`, `month_key`, `source`, `blocek_file_id`, `amount_cents`, `amount_literal`,
	`currency`, `receipt_at`, `receipt_timestamp_raw`, `ekasa_uid`, `ekasa_okp`, `ekasa_payload`,
	`supplier_name`, `dic`, `ico`, `ic_dph`, `kp`, `receipt_number`, `recap_base_cents`,
	`recap_base_literal`, `recap_vat_cents`, `recap_vat_literal`, `decode_status`, `confirmed_at`,
	`created_at`
) SELECT
	`id`, `company_id`, `month_key`, `source`, `blocek_file_id`, `amount_cents`, `amount_literal`,
	`currency`, `receipt_at`, `receipt_timestamp_raw`, `ekasa_uid`, `ekasa_okp`, `ekasa_payload`,
	`supplier_name`, `dic`, `ico`, `ic_dph`, `kp`, `receipt_number`, `recap_base_cents`,
	`recap_base_literal`, `recap_vat_cents`, `recap_vat_literal`, `decode_status`, `confirmed_at`,
	`created_at`
FROM `payments`;
--> statement-breakpoint
DROP TABLE `payments`;
--> statement-breakpoint
ALTER TABLE `__payments_new` RENAME TO `payments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_blocek_file_id_unique` ON `payments` (`blocek_file_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `proofs` (
	`drive_file_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_file_id`) REFERENCES `files`(`drive_file_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pairings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`proof_drive_file_id` text NOT NULL,
	`created_by` text NOT NULL,
	`confidence` text,
	`reason` text,
	`created_at` text NOT NULL,
	`unpaired_at` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_drive_file_id`) REFERENCES `proofs`(`drive_file_id`) ON UPDATE no action ON DELETE no action
);
