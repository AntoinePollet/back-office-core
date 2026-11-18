CREATE TABLE `cms_workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_name` text NOT NULL,
	`event` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`test` integer DEFAULT false NOT NULL,
	`steps` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cms_workflow_runs_started` ON `cms_workflow_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `cms_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`actions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
