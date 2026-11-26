CREATE TABLE `cms_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`collection` text NOT NULL,
	`entry_id` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`interval` text NOT NULL,
	`status` text NOT NULL,
	`email` text,
	`name` text,
	`livemode` integer NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`canceled_at` integer,
	`origin` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_subscriptions_subscription_id_unique` ON `cms_subscriptions` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `cms_subscriptions_created` ON `cms_subscriptions` (`created_at`);--> statement-breakpoint
ALTER TABLE `cms_payments` ADD `invoice` text;--> statement-breakpoint
ALTER TABLE `cms_payments` ADD `subscription` text;--> statement-breakpoint
ALTER TABLE `cms_payments` ADD `discount_amount` integer DEFAULT 0 NOT NULL;