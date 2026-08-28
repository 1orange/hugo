CREATE TABLE `payment_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`name` text NOT NULL,
	`vat_rate_literal` text NOT NULL,
	`quantity_literal` text NOT NULL,
	`unit_price_literal` text NOT NULL,
	`line_total_literal` text NOT NULL,
	`line_total_cents` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_vat_recap` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`rate_literal` text NOT NULL,
	`base_literal` text NOT NULL,
	`base_cents` integer NOT NULL,
	`vat_literal` text NOT NULL,
	`vat_cents` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `payments` ADD `ekasa_okp` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `supplier_name` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `dic` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `ico` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `ic_dph` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `kp` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_number` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `recap_base_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `recap_base_literal` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `recap_vat_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `recap_vat_literal` text;