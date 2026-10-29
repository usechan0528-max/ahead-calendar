CREATE UNIQUE INDEX `idx_account_profiles_nickname_unique` ON `account_profiles` (lower(nickname));
--> statement-breakpoint
PRAGMA optimize;
