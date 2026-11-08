ALTER TABLE `device_state` ADD `signed_out_at` text;--> statement-breakpoint
ALTER TABLE `device_state` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `device_state` ADD `plan_checked_at` text;--> statement-breakpoint
ALTER TABLE `device_state` ADD `plan_renews_at` text;