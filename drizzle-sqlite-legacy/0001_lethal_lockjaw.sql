CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`company_id` integer,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `files` (
	`drive_file_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`folder_slot` text,
	`parent_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`drive_created_time` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `months` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`drive_folder_id` text NOT NULL,
	`closed_at` text,
	`opened_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `months_drive_folder_id_unique` ON `months` (`drive_folder_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`drive_parent_folder_id` text,
	`canonical_folder_names_json` text NOT NULL,
	`last_sweep_at` text
);
