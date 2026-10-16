CREATE TABLE `sync_seen` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`gmail_id` text NOT NULL,
	`generation` text NOT NULL
);
