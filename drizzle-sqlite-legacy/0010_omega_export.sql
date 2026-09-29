ALTER TABLE `documents` ADD `export_number` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_company_export_number` ON `documents` (`company_id`, `export_number`);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`country` text NOT NULL,
	`ico` text NOT NULL,
	`legal_name` text NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`psc` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`dic` text DEFAULT '' NOT NULL,
	`ic_dph` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_company_country_ico` ON `partners` (`company_id`, `country`, `ico`);
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t01_evidence_code` text DEFAULT 'OF' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t01_series_code` text DEFAULT 'OF' NOT NULL;
