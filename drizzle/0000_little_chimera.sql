CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`source` text NOT NULL,
	`plan_id` text,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actions_tenant` ON `actions` (`tenant`,`created`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`tenant` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`email` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`source` text NOT NULL,
	`sender` text NOT NULL,
	`address` text NOT NULL,
	`category` text NOT NULL,
	`count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`oldest` integer NOT NULL,
	`newest` integer NOT NULL,
	`protected` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`list_id` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `groups_tenant_source` ON `mail_groups` (`tenant`,`source`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`source` text NOT NULL,
	`cursor` text,
	`processed` integer NOT NULL,
	`status` text NOT NULL,
	`history_id` text,
	`updated` integer NOT NULL,
	`lease` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_tenant` ON `jobs` (`tenant`,`source`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`gmail_id` text NOT NULL,
	`metadata` text NOT NULL,
	`classification` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_tenant` ON `messages` (`tenant`,`gmail_id`);--> statement-breakpoint
CREATE TABLE `oauth_transactions` (
	`state` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`verifier` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plans_tenant` ON `plans` (`tenant`,`created`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`command` text NOT NULL,
	`compiled` text NOT NULL,
	`enabled` integer NOT NULL,
	`authorized` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_tenant` ON `rules` (`tenant`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`created` integer NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
