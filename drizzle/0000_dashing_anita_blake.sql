CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`vendor` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`unit` text NOT NULL,
	`price` integer NOT NULL,
	`category` text NOT NULL,
	`total_price` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text(100) NOT NULL,
	`email` text(255) NOT NULL,
	`password` text(255) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);