CREATE TABLE `cms_form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form` text NOT NULL,
	`values` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cms_form_submissions_form` ON `cms_form_submissions` (`form`,`created_at`);--> statement-breakpoint
CREATE TABLE `cms_module_settings` (
	`module` text PRIMARY KEY NOT NULL,
	`values` text NOT NULL,
	`secrets` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL
);
