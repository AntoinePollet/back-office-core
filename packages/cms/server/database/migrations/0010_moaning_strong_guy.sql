CREATE TABLE `cms_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`payment_intent` text,
	`collection` text NOT NULL,
	`entry_id` text NOT NULL,
	`title` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_amount` integer NOT NULL,
	`amount` integer NOT NULL,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`email` text,
	`name` text,
	`shipping` text,
	`status` text NOT NULL,
	`livemode` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_payments_session_id_unique` ON `cms_payments` (`session_id`);--> statement-breakpoint
CREATE INDEX `cms_payments_created` ON `cms_payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `cms_payments_intent` ON `cms_payments` (`payment_intent`);