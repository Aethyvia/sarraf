ALTER TABLE `accounts` ADD `enter_arrived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `entered_as` text;