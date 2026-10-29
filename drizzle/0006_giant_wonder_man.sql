CREATE TABLE `notification_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`subscription_id` integer NOT NULL,
	`kind` text DEFAULT 'test' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`claimed_at` text,
	`sent_at` text,
	`acked_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_jobs_idempotency_key_unique` ON `notification_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_notification_jobs_status_scheduled` ON `notification_jobs` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_notification_jobs_owner_created` ON `notification_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`expiration_time` integer,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_owner_active` ON `push_subscriptions` (`owner_id`,`disabled_at`);