ALTER TABLE `events` ADD `recurrence_interval` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence_day` integer;