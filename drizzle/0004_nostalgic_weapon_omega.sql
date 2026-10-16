ALTER TABLE `oauth_transactions` ADD `epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `connection_epoch` integer DEFAULT 0 NOT NULL;