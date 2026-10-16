CREATE TABLE `retention_health` (
	`id` text PRIMARY KEY NOT NULL,
	`last_started` integer NOT NULL,
	`last_completed` integer,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actions_plan` ON `actions` (`plan_id`);--> statement-breakpoint
CREATE INDEX `extension_devices_expiry` ON `extension_devices` (`expires`);--> statement-breakpoint
CREATE INDEX `oauth_expiry` ON `oauth_transactions` (`expires`);--> statement-breakpoint
CREATE INDEX `plans_expiry` ON `plans` (`expires`);