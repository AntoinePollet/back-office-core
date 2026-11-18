CREATE TABLE `cms_user_access` (
	`user_id` text PRIMARY KEY NOT NULL,
	`types` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
