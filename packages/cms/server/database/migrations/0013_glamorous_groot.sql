CREATE TABLE `cms_not_found` (
	`path` text PRIMARY KEY NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`referrer` text
);
--> statement-breakpoint
CREATE INDEX `cms_not_found_last` ON `cms_not_found` (`last_at`);--> statement-breakpoint
CREATE TABLE `cms_redirect_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_locale` text,
	`target_url` text,
	`status` integer DEFAULT 301 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_redirect_rules_source` ON `cms_redirect_rules` (`source`);--> statement-breakpoint
CREATE INDEX `cms_redirect_rules_target` ON `cms_redirect_rules` (`target_id`);--> statement-breakpoint
CREATE TABLE `cms_schedules` (
	`entry_id` text NOT NULL,
	`locale` text NOT NULL,
	`action` text NOT NULL,
	`type` text NOT NULL,
	`at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`claimed_at` integer,
	`failed_at` integer,
	`error` text,
	PRIMARY KEY(`entry_id`, `locale`, `action`),
	FOREIGN KEY (`entry_id`) REFERENCES `cms_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_schedules_at` ON `cms_schedules` (`at`);--> statement-breakpoint
ALTER TABLE `cms_media` ADD `focus` text;