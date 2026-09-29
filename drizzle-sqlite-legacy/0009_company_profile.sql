CREATE TABLE `company_profiles` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`legal_name` text NOT NULL,
	`address` text NOT NULL,
	`ico` text NOT NULL,
	`dic` text NOT NULL,
	`ic_dph` text NOT NULL,
	`register_source` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
