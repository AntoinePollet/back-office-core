CREATE TABLE `cms_redirects` (
	`type` text NOT NULL,
	`locale` text NOT NULL,
	`slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`type`, `locale`, `slug`),
	FOREIGN KEY (`entry_id`) REFERENCES `cms_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cms_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
