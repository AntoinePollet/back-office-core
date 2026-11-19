CREATE TABLE `cms_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`action` text NOT NULL,
	`category` text NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_email` text,
	`summary` text NOT NULL,
	`target_kind` text,
	`target_type` text,
	`target_id` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `cms_activity_at` ON `cms_activity` (`at`);--> statement-breakpoint
CREATE TABLE `cms_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text,
	`title` text NOT NULL,
	`owner_id` text,
	`snapshot` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`deleted_by` text,
	`deleted_by_name` text
);
--> statement-breakpoint
CREATE INDEX `cms_trash_item` ON `cms_trash` (`kind`,`item_id`);--> statement-breakpoint
CREATE INDEX `cms_trash_deleted` ON `cms_trash` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `cms_trash_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`trash_id` text NOT NULL,
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
	FOREIGN KEY (`trash_id`) REFERENCES `cms_trash`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_trash_revisions_trash` ON `cms_trash_revisions` (`trash_id`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_user` ON `two_factor` (`user_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `two_factor_enabled` integer DEFAULT false;