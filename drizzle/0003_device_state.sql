CREATE TABLE `device_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text,
	`user_email` text,
	`sign_in_method` text,
	`drive_email` text,
	`backup_enabled` integer DEFAULT false NOT NULL,
	`last_backup_at` text,
	`backup_failing_since` text,
	`backup_moved_at` text,
	`backup_moved_to` text,
	CONSTRAINT "device_state_single_row" CHECK("device_state"."id" = 1)
);
