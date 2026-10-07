CREATE TABLE `scheduler_health` (
	`id` text PRIMARY KEY NOT NULL,
	`last_tick` integer NOT NULL,
	`last_completed` integer
);
--> statement-breakpoint
CREATE TABLE `sync_schedules` (
	`tenant` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`next_due` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'off' NOT NULL,
	`generation` text NOT NULL,
	`owner` text,
	`lease` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_success` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `sync_schedules_due` ON `sync_schedules` (`enabled`,`next_due`,`lease`);