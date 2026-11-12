ALTER TABLE `settings` ADD `tours_seen` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `settings` SET `lock_after_seconds` = 60 WHERE `lock_after_seconds` = 0;
