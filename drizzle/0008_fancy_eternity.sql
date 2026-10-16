ALTER TABLE `credentials` ADD `permission` text DEFAULT 'readonly' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_transactions` ADD `requested_scope` text DEFAULT 'readonly' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_transactions` ADD `account_email` text;