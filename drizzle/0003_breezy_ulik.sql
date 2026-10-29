ALTER TABLE `events` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence` text DEFAULT 'none' NOT NULL;