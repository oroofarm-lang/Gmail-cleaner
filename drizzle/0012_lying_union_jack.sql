CREATE TABLE `active_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started` integer NOT NULL,
	`generation` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_admission` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL
);

--> statement-breakpoint
INSERT INTO service_admission(id,mode,generation,updated) VALUES('service','open',0,0);
