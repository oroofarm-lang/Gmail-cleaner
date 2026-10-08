CREATE TABLE `extension_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`connection_epoch` integer NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `extension_devices_tenant` ON `extension_devices` (`tenant`,`expires`);