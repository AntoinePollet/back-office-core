CREATE TABLE `cms_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`changed` text NOT NULL,
	`published` text NOT NULL,
	`unpublished` text NOT NULL,
	`origin` text,
	`author_id` text,
	`author_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `cms_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_revisions_entry` ON `cms_revisions` (`entry_id`,`version`);--> statement-breakpoint
ALTER TABLE `cms_entries` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cms_entries` ADD `shared_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cms_entries` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `cms_entry_locales` ADD `version` integer DEFAULT 0 NOT NULL;