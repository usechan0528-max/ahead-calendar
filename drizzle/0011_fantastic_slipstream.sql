CREATE TABLE `daily_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`target` integer DEFAULT 3 NOT NULL,
	CONSTRAINT "goal_target_range" CHECK("daily_goals"."target" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_goal_owner_day` ON `daily_goals` (`owner_id`,`day`);--> statement-breakpoint
CREATE TABLE `occurrence_completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`occurrence_date` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` integer DEFAULT 0 NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "completion_boolean" CHECK("occurrence_completions"."complete" IN (0, 1)),
	CONSTRAINT "completion_kind" CHECK("occurrence_completions"."kind" IN ('event', 'preparation'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_completion_identity` ON `occurrence_completions` (`owner_id`,`event_id`,`occurrence_date`,`kind`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_completion_owner_date` ON `occurrence_completions` (`owner_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `xp_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`action_key` text NOT NULL,
	`kind` text NOT NULL,
	`earned_date` text NOT NULL,
	`xp` integer NOT NULL,
	`rules_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "xp_bounded" CHECK("xp_ledger"."xp" >= 0 AND "xp_ledger"."xp" <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_xp_identity` ON `xp_ledger` (`owner_id`,`action_key`);--> statement-breakpoint
CREATE INDEX `idx_xp_owner_date` ON `xp_ledger` (`owner_id`,`earned_date`);