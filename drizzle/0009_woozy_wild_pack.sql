CREATE TABLE `notification_planner_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `notification_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `reminders_changed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_jobs` ADD `occurrence_at` text;--> statement-breakpoint
ALTER TABLE `notification_jobs` ADD `reminder_offset_minutes` integer;--> statement-breakpoint
ALTER TABLE `notification_jobs` ADD `event_revision` integer;--> statement-breakpoint
ALTER TABLE `notification_jobs` ADD `expires_at` text;--> statement-breakpoint
CREATE INDEX `idx_notification_jobs_event_status` ON `notification_jobs` (`event_id`,`status`);--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `reminders_enabled_at` text;--> statement-breakpoint
PRAGMA optimize;
