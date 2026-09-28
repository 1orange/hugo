-- The Drive changes channel the app watches (ADR 0020): Google notifies its
-- webhook, and the token proves a notification is for this channel.
ALTER TABLE `settings` ADD `drive_watch_channel_id` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD `drive_watch_resource_id` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD `drive_watch_token` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD `drive_watch_expires_at` text;
