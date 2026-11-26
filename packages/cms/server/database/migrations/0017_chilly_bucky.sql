CREATE TABLE `cms_appointment_slots` (
	`at` integer PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `cms_appointments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_appointment_slots_appointment` ON `cms_appointment_slots` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `cms_appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`service_label` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`note` text,
	`locale` text NOT NULL,
	`location` text,
	`origin` text,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`paid_at` integer,
	`created_by` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cms_appointments_start` ON `cms_appointments` (`start`);--> statement-breakpoint
CREATE INDEX `cms_appointments_status` ON `cms_appointments` (`status`,`start`);