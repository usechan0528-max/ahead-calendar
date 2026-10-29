CREATE TABLE `notification_scheduler_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_nonces_received` ON `notification_scheduler_nonces` (`received_at`);