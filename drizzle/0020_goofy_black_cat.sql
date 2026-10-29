CREATE TABLE `event_category_colors` (
	`owner_id` text NOT NULL,
	`category` text NOT NULL,
	`color` text NOT NULL,
	PRIMARY KEY(`owner_id`, `category`)
);
