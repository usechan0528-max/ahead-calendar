CREATE TABLE `recommendation_settings` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`profile` text DEFAULT 'auto' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recommendation_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`rule_key` text NOT NULL,
	`preparation_id` integer,
	`dismissed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recommendation_state_event_rule` ON `recommendation_state` (`event_id`,`rule_key`);--> statement-breakpoint
ALTER TABLE `preparation_items` ADD `recommendation_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_preparation_recommendation` ON `preparation_items` (`event_id`,`recommendation_key`);