CREATE TABLE `ai_consents` (
	`tenant` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`version` integer NOT NULL,
	`scope` text NOT NULL,
	`model` text NOT NULL,
	`epoch` text NOT NULL,
	`updated` integer NOT NULL
);
