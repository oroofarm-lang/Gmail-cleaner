ALTER TABLE `actions` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `lease` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `lease` integer DEFAULT 0 NOT NULL;