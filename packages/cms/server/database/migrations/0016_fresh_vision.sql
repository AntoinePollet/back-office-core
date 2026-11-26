CREATE TABLE `cms_newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`locale` text NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`origin` text,
	`created_at` integer NOT NULL,
	`confirmation_sent_at` integer,
	`confirmed_at` integer,
	`unsubscribed_at` integer,
	`sync` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_newsletter_subscribers_email_unique` ON `cms_newsletter_subscribers` (`email`);--> statement-breakpoint
CREATE INDEX `cms_newsletter_status` ON `cms_newsletter_subscribers` (`status`,`created_at`);