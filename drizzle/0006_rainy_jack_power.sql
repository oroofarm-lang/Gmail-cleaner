CREATE TABLE `sync_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_seen_tenant_message` ON `sync_seen` (`tenant`,`gmail_id`,`generation`);