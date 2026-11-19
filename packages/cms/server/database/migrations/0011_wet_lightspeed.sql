CREATE TABLE `cms_media_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cms_media_folders_parent` ON `cms_media_folders` (`parent_id`);--> statement-breakpoint
ALTER TABLE `cms_media` ADD `folder_id` text REFERENCES cms_media_folders(id);--> statement-breakpoint
CREATE INDEX `cms_media_folder` ON `cms_media` (`folder_id`);