ALTER TABLE `settings` ADD `omega_t00_evidence_code` text DEFAULT 'IDk' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t00_series_code` text DEFAULT 'IDk' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t00_document_type_code` text DEFAULT '180' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t00_foreign_document_type_code` text DEFAULT '380' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t01_received_evidence_code` text DEFAULT 'DF' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `omega_t01_received_series_code` text DEFAULT 'DF' NOT NULL;
