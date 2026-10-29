CREATE TABLE `account_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_changed_at` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "account_profiles_username_format" CHECK(length("account_profiles"."username") BETWEEN 4 AND 20 AND "account_profiles"."username" NOT GLOB '*[^a-z0-9_]*' AND substr("account_profiles"."username", 1, 1) GLOB '[a-z]'),
	CONSTRAINT "account_profiles_nickname_length" CHECK(length("account_profiles"."nickname") BETWEEN 2 AND 16),
	CONSTRAINT "account_profiles_revision" CHECK("account_profiles"."revision" >= 0),
	CONSTRAINT "account_profiles_timestamps" CHECK("account_profiles"."created_at" >= 0 AND "account_profiles"."nickname_changed_at" >= "account_profiles"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_profiles_username` ON `account_profiles` (`username`);