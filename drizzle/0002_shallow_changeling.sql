CREATE TABLE `notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`channel` text DEFAULT 'browser' NOT NULL,
	`kind` text DEFAULT 'test' NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_owner_sent` ON `notification_deliveries` (`owner_id`,`sent_at`);