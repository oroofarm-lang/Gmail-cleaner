CREATE TABLE `retention_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`row_id` text NOT NULL,
	`revision` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `extension_devices_expiry`;--> statement-breakpoint
CREATE INDEX `extension_devices_expiry` ON `extension_devices` (`expires`,`id`);--> statement-breakpoint
DROP INDEX `oauth_expiry`;--> statement-breakpoint
CREATE INDEX `oauth_expiry` ON `oauth_transactions` (`expires`,`state`);--> statement-breakpoint
DROP INDEX `plans_expiry`;--> statement-breakpoint
CREATE INDEX `plans_expiry` ON `plans` (`expires`,`id`);
--> statement-breakpoint
INSERT INTO retention_cursors(id,expires,row_id,revision) VALUES('plans',-1,'','initial');
