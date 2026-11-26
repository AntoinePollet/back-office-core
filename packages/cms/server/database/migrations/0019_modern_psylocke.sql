CREATE TABLE `cms_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`stack` text NOT NULL,
	`path` text NOT NULL,
	`method` text NOT NULL,
	`status` integer,
	`browser` text NOT NULL,
	`release` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_errors_fingerprint_unique` ON `cms_errors` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `cms_errors_last` ON `cms_errors` (`last_at`);--> statement-breakpoint
CREATE TABLE `cms_uptime_checks` (
	`at` integer PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	`status` integer,
	`ms` integer NOT NULL,
	`detail` text NOT NULL
);
