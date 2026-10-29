CREATE TABLE `route_request_limits` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`request_day` text NOT NULL,
	`request_count` integer NOT NULL,
	`last_request_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `travel_plan_json` text;