CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`institution` text,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`goal_allocation_id` text,
	`file_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_allocation_id`) REFERENCES `goal_allocations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachments_one_owner" CHECK(("attachments"."transaction_id" is null) <> ("attachments"."goal_allocation_id" is null))
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`category_id` text,
	`currency` text NOT NULL,
	`amount` text NOT NULL,
	`period` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`notify_80` integer DEFAULT true NOT NULL,
	`notify_100` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `budgets_ledger` ON `budgets` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `categories_parent` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `currency_order` (
	`currency` text PRIMARY KEY NOT NULL,
	`rank` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goal_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` text NOT NULL,
	`date` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `goal_allocations_goal` ON `goal_allocations` (`goal_id`);--> statement-breakpoint
CREATE INDEX `goal_allocations_account` ON `goal_allocations` (`account_id`);--> statement-breakpoint
CREATE TABLE `import_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`header_signature` text NOT NULL,
	`column_map` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledgers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledgers_one_default` ON `ledgers` (`is_default`) WHERE "ledgers"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `market_rates` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`base`, `quote`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `person_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`transaction_id` text,
	`source` text NOT NULL,
	`currency` text NOT NULL,
	`amount` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_entries_settlement_iff_no_tx" CHECK(("person_entries"."transaction_id" is null) = ("person_entries"."source" = 'settlement'))
);
--> statement-breakpoint
CREATE INDEX `person_entries_person` ON `person_entries` (`person_id`);--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`amount_type` text NOT NULL,
	`name` text NOT NULL,
	`amount` text,
	`currency` text NOT NULL,
	`last_amount` text,
	`account_id` text,
	`to_account_id` text,
	`category_id` text,
	`ledger_id` text,
	`reference_person_id` text,
	`repeat_rule` text NOT NULL,
	`next_due_date` text NOT NULL,
	`show_on_home_days` integer DEFAULT 3 NOT NULL,
	`auto_add` integer DEFAULT false NOT NULL,
	`ends_on` text,
	`max_occurrences` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reference_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_amount_iff_same" CHECK(("recurring_items"."amount" is null) = ("recurring_items"."amount_type" = 'varies')),
	CONSTRAINT "recurring_to_account_iff_transfer" CHECK(("recurring_items"."to_account_id" is not null) = ("recurring_items"."kind" = 'transfer')),
	CONSTRAINT "recurring_show_on_home_days" CHECK("recurring_items"."show_on_home_days" in (0, 1, 3, 7)),
	CONSTRAINT "recurring_auto_add_same_only" CHECK(not ("recurring_items"."auto_add" = 1 and "recurring_items"."amount_type" = 'varies'))
);
--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`target_amount` text NOT NULL,
	`priority` integer NOT NULL,
	`completed_at` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_currency` text NOT NULL,
	`number_format` text DEFAULT '1,000.00' NOT NULL,
	`compact_numbers` integer DEFAULT true NOT NULL,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`fiscal_year_for_analytics` integer DEFAULT false NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`hide_amounts` integer DEFAULT false NOT NULL,
	`show_income_by_person` integer DEFAULT true NOT NULL,
	`app_lock_enabled` integer DEFAULT false NOT NULL,
	`pin_hash` text,
	`pin_length` integer DEFAULT 4 NOT NULL,
	`biometrics_enabled` integer DEFAULT false NOT NULL,
	`lock_after_seconds` integer DEFAULT 0 NOT NULL,
	`hide_in_recents` integer DEFAULT false NOT NULL,
	`failed_pin_attempts` integer DEFAULT 0 NOT NULL,
	`pin_locked_until` text,
	`backup_frequency` text DEFAULT 'daily' NOT NULL,
	`backup_wifi_only` integer DEFAULT true NOT NULL,
	`notify_budget_80` integer DEFAULT true NOT NULL,
	`notify_budget_100` integer DEFAULT true NOT NULL,
	`notify_recurring_due` integer DEFAULT true NOT NULL,
	`notify_expected_late` integer DEFAULT true NOT NULL,
	`notify_in_transit` integer DEFAULT false NOT NULL,
	`notify_backup_problems` integer DEFAULT true NOT NULL,
	`onboarding_completed_at` text,
	`device_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_pin_length" CHECK("settings"."pin_length" in (4, 6)),
	CONSTRAINT "settings_fy_month" CHECK("settings"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE `split_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`person_id` text,
	`share_amount` text NOT NULL,
	`share_percent` text,
	`split_mode` text NOT NULL,
	`is_treat` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `split_shares_transaction` ON `split_shares` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `tax_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year_start` text NOT NULL,
	`fiscal_year_end` text NOT NULL,
	`exported_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`rate` text,
	`rate_mode` text,
	`deduction` text NOT NULL,
	`account_id` text,
	`is_tax` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "charges_account_iff_on_top" CHECK(("transaction_charges"."account_id" is null) = ("transaction_charges"."deduction" = 'already_deducted')),
	CONSTRAINT "charges_no_rate_on_top" CHECK("transaction_charges"."deduction" = 'already_deducted' or "transaction_charges"."rate" is null),
	CONSTRAINT "charges_withholding_is_tax" CHECK("transaction_charges"."type" <> 'withholding_tax' or "transaction_charges"."is_tax" = 1)
);
--> statement-breakpoint
CREATE INDEX `charges_transaction` ON `transaction_charges` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`expected_date` text,
	`scheduled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'cleared' NOT NULL,
	`ledger_id` text,
	`category_id` text,
	`reference_person_id` text,
	`account_id` text,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`rate` text,
	`rate_mode` text,
	`account_amount` text,
	`to_account_id` text,
	`to_amount` text,
	`transfer_person_id` text,
	`paid_by_person_id` text,
	`net_amount` text,
	`reimbursable` integer DEFAULT false NOT NULL,
	`expected_from_person_id` text,
	`reimbursement_status` text,
	`parent_id` text,
	`link_type` text,
	`counts_as_amount` text,
	`counts_as_rate` text,
	`recurring_id` text,
	`recurring_due_date` text,
	`auto_added` integer DEFAULT false NOT NULL,
	`notes` text,
	`market_rate_at_entry` text,
	`market_rate_fetched_at` text,
	`import_batch_id` text,
	`external_ref` text,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reference_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transfer_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paid_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`expected_from_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transactions_link_pair" CHECK(("transactions"."parent_id" is null) = ("transactions"."link_type" is null)),
	CONSTRAINT "transactions_link_expense_only" CHECK("transactions"."link_type" is null or "transactions"."kind" = 'expense'),
	CONSTRAINT "transactions_paid_by_no_account" CHECK("transactions"."paid_by_person_id" is null or "transactions"."account_id" is null)
);
--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_to_account` ON `transactions` (`to_account_id`);--> statement-breakpoint
CREATE INDEX `transactions_parent` ON `transactions` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_one_opening_balance` ON `transactions` (`account_id`) WHERE "transactions"."kind" = 'opening_balance' and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_recurring_due` ON `transactions` (`recurring_id`,`recurring_due_date`);