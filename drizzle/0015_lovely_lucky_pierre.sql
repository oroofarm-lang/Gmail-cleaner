CREATE INDEX `actions_status_lease` ON `actions` (`status`,`lease`);--> statement-breakpoint
CREATE INDEX `active_operations_started` ON `active_operations` (`started`);