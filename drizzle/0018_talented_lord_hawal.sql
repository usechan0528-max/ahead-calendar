CREATE TABLE `event_occurrence_overrides` (
	`event_id` integer NOT NULL,
	`original_date` text NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`data_json` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "occurrence_override_cancelled" CHECK("event_occurrence_overrides"."cancelled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_occurrence_override_identity` ON `event_occurrence_overrides` (`event_id`,`original_date`);--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence_until` text;--> statement-breakpoint
ALTER TABLE `notification_jobs` ADD `original_occurrence_date` text;