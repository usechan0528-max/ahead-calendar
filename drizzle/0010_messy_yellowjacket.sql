ALTER TABLE `events` ADD `all_day` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `all_day_reminder_time` text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `events` ADD `end_time` text;