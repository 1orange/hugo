CREATE TABLE `drive_mutations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`company_id` integer NOT NULL,
	`previous_parent` text NOT NULL,
	`previous_name` text NOT NULL,
	`new_parent` text NOT NULL,
	`new_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`intended_at` text NOT NULL,
	`applied_at` text,
	`failure_message` text,
	`undone_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `month_folders` (
	`drive_folder_id` text PRIMARY KEY NOT NULL,
	`company_id` integer NOT NULL,
	`month_key` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text NOT NULL,
	`can_rename` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
