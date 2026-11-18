CREATE TABLE `cms_review_requests` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_by_name` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `cms_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cms_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rights` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cms_entries` ADD `created_by` text;