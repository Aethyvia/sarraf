/**
 * Local database schema (expo-sqlite + Drizzle).
 * Source: "Sarraf — Data Schema", with the Nov 7 sections applied over earlier rows.
 *
 * Conventions (Decided):
 * - Every row has a permanent UUID text primary key.
 * - Money and rates are exact decimal strings (TEXT), never REAL or integer minor units.
 * - `date` columns are local calendar dates "YYYY-MM-DD"; `*_at` columns are UTC ISO timestamps.
 * - Balances, Usable, person balances and goal totals are derived, never stored.
 * - Foreign keys to accounts, people and categories are ON DELETE RESTRICT; the app cascades itself.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const money = (name: string) => text(name);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

// ── Settings ────────────────────────────────────────────────────────────────

/** Single row (id = 1). */
export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    defaultCurrency: text('default_currency').notNull(),
    numberFormat: text('number_format', {
      enum: ['1,000.00', '1.000,00', '1 000,00', '1 000.00', "1'000.00"],
    })
      .notNull()
      .default('1,000.00'),
    compactNumbers: bool('compact_numbers').notNull().default(true),
    fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(1),
    fiscalYearForAnalytics: bool('fiscal_year_for_analytics').notNull().default(false),
    theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
    hideAmounts: bool('hide_amounts').notNull().default(false),
    showIncomeByPerson: bool('show_income_by_person').notNull().default(true),
    appLockEnabled: bool('app_lock_enabled').notNull().default(false),
    pinHash: text('pin_hash'),
    pinLength: integer('pin_length').notNull().default(4),
    biometricsEnabled: bool('biometrics_enabled').notNull().default(false),
    lockAfterSeconds: integer('lock_after_seconds').notNull().default(0),
    hideInRecents: bool('hide_in_recents').notNull().default(false),
    failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
    pinLockedUntil: text('pin_locked_until'),
    backupFrequency: text('backup_frequency', { enum: ['daily', 'weekly', 'manual'] })
      .notNull()
      .default('daily'),
    backupWifiOnly: bool('backup_wifi_only').notNull().default(true),
    notifyBudget80: bool('notify_budget_80').notNull().default(true),
    notifyBudget100: bool('notify_budget_100').notNull().default(true),
    notifyRecurringDue: bool('notify_recurring_due').notNull().default(true),
    notifyExpectedLate: bool('notify_expected_late').notNull().default(true),
    notifyInTransit: bool('notify_in_transit').notNull().default(false),
    notifyBackupProblems: bool('notify_backup_problems').notNull().default(true),
    onboardingCompletedAt: text('onboarding_completed_at'),
    /** This phone's id, written into each backup; backups stop when Supabase names another phone. */
    deviceId: text('device_id').notNull(),
    ...timestamps,
  },
  (t) => [
    check('settings_single_row', sql`${t.id} = 1`),
    check('settings_pin_length', sql`${t.pinLength} in (4, 6)`),
    check('settings_fy_month', sql`${t.fiscalYearStartMonth} between 1 and 12`),
  ],
);

/** Order of Home's currency tiles. A tile shows only when an account uses that currency. */
export const currencyOrder = sqliteTable('currency_order', {
  currency: text('currency').primaryKey(),
  rank: integer('rank').notNull(),
  ...timestamps,
});

// ── Ledgers, accounts, categories, people ───────────────────────────────────

export const ledgers = sqliteTable(
  'ledgers',
  {
    id: id(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    isDefault: bool('is_default').notNull().default(false),
    rank: integer('rank').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ledgers_one_default').on(t.isDefault).where(sql`${t.isDefault} = 1`)],
);

export const accounts = sqliteTable('accounts', {
  id: id(),
  /** Shown exactly as typed everywhere, e.g. "Alfalah PKR". */
  name: text('name').notNull(),
  /** Fixed at creation. */
  currency: text('currency').notNull(),
  /** Groups one provider's balances, e.g. Payoneer. Null for a plain bank account or cash. */
  institution: text('institution'),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  rank: integer('rank').notNull().default(0),
  archivedAt: text('archived_at'),
  ...timestamps,
});

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    name: text('name').notNull(),
    /** Locked once any transaction uses the category. */
    kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
    /** Two levels only: parent must be a top-level category (enforced in app logic). */
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id, { onDelete: 'restrict' }),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    /** Built-in Fees & charges: can be renamed, never deleted. */
    isSystem: bool('is_system').notNull().default(false),
    rank: integer('rank').notNull().default(0),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [index('categories_parent').on(t.parentId)],
);

export const people = sqliteTable('people', {
  id: id(),
  name: text('name').notNull(),
  note: text('note'),
  archivedAt: text('archived_at'),
  ...timestamps,
});

// ── Recurring items (declared before transactions, which reference them) ────

export const recurringItems = sqliteTable(
  'recurring_items',
  {
    id: id(),
    kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    amountType: text('amount_type', { enum: ['same', 'varies'] }).notNull(),
    name: text('name').notNull(),
    amount: money('amount'),
    currency: text('currency').notNull(),
    /** Last confirmed amount; Home shows "Usually …" for varies items. */
    lastAmount: money('last_amount'),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    toAccountId: text('to_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    ledgerId: text('ledger_id').references(() => ledgers.id, { onDelete: 'restrict' }),
    referencePersonId: text('reference_person_id').references(() => people.id, { onDelete: 'restrict' }),
    /** JSON, e.g. {"freq":"monthly","interval":1,"day":12} */
    repeatRule: text('repeat_rule', { mode: 'json' }).notNull(),
    nextDueDate: text('next_due_date').notNull(),
    showOnHomeDays: integer('show_on_home_days').notNull().default(3),
    /** Same-amount only. Off = "Remind me, don't auto-add". */
    autoAdd: bool('auto_add').notNull().default(false),
    endsOn: text('ends_on'),
    maxOccurrences: integer('max_occurrences'),
    active: bool('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check('recurring_amount_iff_same', sql`(${t.amount} is null) = (${t.amountType} = 'varies')`),
    check('recurring_to_account_iff_transfer', sql`(${t.toAccountId} is not null) = (${t.kind} = 'transfer')`),
    check('recurring_show_on_home_days', sql`${t.showOnHomeDays} in (0, 1, 3, 7)`),
    check('recurring_auto_add_same_only', sql`not (${t.autoAdd} = 1 and ${t.amountType} = 'varies')`),
  ],
);

// ── Transactions ────────────────────────────────────────────────────────────

export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    kind: text('kind', {
      enum: ['expense', 'income', 'transfer', 'opening_balance', 'balance_adjustment'],
    }).notNull(),
    date: text('date').notNull(),
    /** Pending only, optional: "expected Oct 14". */
    expectedDate: text('expected_date'),
    /** True while saved with a future date (Upcoming); false once confirmed. A scheduled row never counts. */
    scheduled: bool('scheduled').notNull().default(false),
    status: text('status', { enum: ['pending', 'in_transit', 'cleared', 'cancelled'] })
      .notNull()
      .default('cleared'),
    ledgerId: text('ledger_id').references(() => ledgers.id, { onDelete: 'restrict' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    /** "Tag someone (note only)": never creates an amount owed. */
    referencePersonId: text('reference_person_id').references(() => people.id, { onDelete: 'restrict' }),
    /** Expense: paid from; income: received into; transfer: From. Null when a person is the From side or paid. */
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    /** Main amount as typed. Income: before deductions. Transfer and expense: what left the account. */
    amount: money('amount').notNull(),
    /** Currency of `amount` as typed; may differ from the account's. */
    currency: text('currency').notNull(),
    /** The rate actually got, from `currency` to the account it converts into. Null when no conversion. */
    rate: money('rate'),
    rateMode: text('rate_mode', { enum: ['rate_known', 'amount_known'] }),
    /** Calculated: change to account_id in its currency, before on-top charges. */
    accountAmount: money('account_amount'),
    toAccountId: text('to_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    /** Calculated for transfers: what reached to_account_id, in its currency. */
    toAmount: money('to_amount'),
    /** Transfer to/from a person: lend, borrow or repay. */
    transferPersonId: text('transfer_person_id').references(() => people.id, { onDelete: 'restrict' }),
    /** Expense "Paid from → Person": they paid, you owe them; account_id null. */
    paidByPersonId: text('paid_by_person_id').references(() => people.id, { onDelete: 'restrict' }),
    /** Display only: what the receiving account really goes up by. Never summed. */
    netAmount: money('net_amount'),
    reimbursable: bool('reimbursable').notNull().default(false),
    expectedFromPersonId: text('expected_from_person_id').references(() => people.id, { onDelete: 'restrict' }),
    reimbursementStatus: text('reimbursement_status', {
      enum: ['awaiting', 'partly_back', 'reimbursed', 'written_off'],
    }),
    /** Refund / reimbursement: the original expense. */
    parentId: text('parent_id').references((): AnySQLiteColumn => transactions.id, { onDelete: 'restrict' }),
    linkType: text('link_type', { enum: ['refund', 'reimbursement'] }),
    /** Linked money back: what it counts as in the original expense's currency, and the rate used. */
    countsAsAmount: money('counts_as_amount'),
    countsAsRate: money('counts_as_rate'),
    recurringId: text('recurring_id').references(() => recurringItems.id, { onDelete: 'restrict' }),
    /** The recurring due date this row was made for; (recurring_id, recurring_due_date) is unique. */
    recurringDueDate: text('recurring_due_date'),
    autoAdded: bool('auto_added').notNull().default(false),
    notes: text('notes'),
    /** Saved on every cross-currency row: for "vs market", "counts as" defaults and conversion cost. */
    marketRateAtEntry: money('market_rate_at_entry'),
    marketRateFetchedAt: text('market_rate_fetched_at'),
    importBatchId: text('import_batch_id'),
    externalRef: text('external_ref'),
    /** Soft delete for Undo; purged later. */
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('transactions_date').on(t.date),
    index('transactions_account').on(t.accountId),
    index('transactions_to_account').on(t.toAccountId),
    index('transactions_parent').on(t.parentId),
    uniqueIndex('transactions_one_opening_balance')
      .on(t.accountId)
      .where(sql`${t.kind} = 'opening_balance' and ${t.deletedAt} is null`),
    uniqueIndex('transactions_recurring_due').on(t.recurringId, t.recurringDueDate),
    check('transactions_link_pair', sql`(${t.parentId} is null) = (${t.linkType} is null)`),
    check('transactions_link_expense_only', sql`${t.linkType} is null or ${t.kind} = 'expense'`),
    check('transactions_paid_by_no_account', sql`${t.paidByPersonId} is null or ${t.accountId} is null`),
  ],
);

export const transactionCharges = sqliteTable(
  'transaction_charges',
  {
    id: id(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: [
        'transfer_fee',
        'platform_fee',
        'withdrawal_fee',
        'bank_charge',
        'service_charge',
        'card_fx_fee',
        'withholding_tax',
        'custom',
      ],
    }).notNull(),
    /** User text for custom types. */
    label: text('label'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    /** Inside-the-amount only, when currency ≠ the transaction's: converts the charge into it. */
    rate: money('rate'),
    rateMode: text('rate_mode', { enum: ['rate_known', 'amount_known'] }),
    deduction: text('deduction', { enum: ['already_deducted', 'charged_separately'] }).notNull(),
    /** Required for on-top charges; null for inside charges. */
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    isTax: bool('is_tax').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('charges_transaction').on(t.transactionId),
    check('charges_account_iff_on_top', sql`(${t.accountId} is null) = (${t.deduction} = 'already_deducted')`),
    check('charges_no_rate_on_top', sql`${t.deduction} = 'already_deducted' or ${t.rate} is null`),
    check('charges_withholding_is_tax', sql`${t.type} <> 'withholding_tax' or ${t.isTax} = 1`),
  ],
);

export const splitShares = sqliteTable(
  'split_shares',
  {
    id: id(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** Null = you. */
    personId: text('person_id').references(() => people.id, { onDelete: 'restrict' }),
    /** In the currency that was charged. */
    shareAmount: money('share_amount').notNull(),
    /** Percent mode only; share_amount is still stored. */
    sharePercent: money('share_percent'),
    splitMode: text('split_mode', { enum: ['equal', 'amounts', 'percent'] }).notNull(),
    isTreat: bool('is_treat').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('split_shares_transaction').on(t.transactionId)],
);

/** Every change to what a person owes. Only transfers, splits, "Paid from → Person" and settlements write here. */
export const personEntries = sqliteTable(
  'person_entries',
  {
    id: id(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['transfer', 'split', 'paid_by_person', 'settlement'] }).notNull(),
    currency: text('currency').notNull(),
    /** Signed: + they owe you, − you owe them. */
    amount: money('amount').notNull(),
    date: text('date').notNull(),
    /** The optional note from Mark as settled. */
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('person_entries_person').on(t.personId),
    check('person_entries_settlement_iff_no_tx', sql`(${t.transactionId} is null) = (${t.source} = 'settlement')`),
  ],
);

// ── Budgets, savings ────────────────────────────────────────────────────────

export const budgets = sqliteTable(
  'budgets',
  {
    id: id(),
    ledgerId: text('ledger_id')
      .notNull()
      .references(() => ledgers.id, { onDelete: 'restrict' }),
    /** Null = all spending in this ledger, one row per currency. */
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    amount: money('amount').notNull(),
    period: text('period', { enum: ['monthly', 'yearly', 'custom'] }).notNull(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    rank: integer('rank').notNull().default(0),
    notify80: bool('notify_80').notNull().default(true),
    notify100: bool('notify_100').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('budgets_ledger').on(t.ledgerId)],
);

export const savingsGoals = sqliteTable('savings_goals', {
  id: id(),
  name: text('name').notNull(),
  /** One currency per goal; amounts are set aside from accounts of that currency. */
  currency: text('currency').notNull(),
  targetAmount: money('target_amount').notNull(),
  /** The lowest-priority goal shrinks first. */
  priority: integer('priority').notNull(),
  completedAt: text('completed_at'),
  archivedAt: text('archived_at'),
  ...timestamps,
});

/** Every change to how much a goal holds. No money moves between accounts. */
export const goalAllocations = sqliteTable(
  'goal_allocations',
  {
    id: id(),
    goalId: text('goal_id')
      .notNull()
      .references(() => savingsGoals.id, { onDelete: 'cascade' }),
    /** An account in the goal's currency the money is set aside from. */
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['add', 'take_out', 'release', 'shrink'] }).notNull(),
    /** Signed: + for add, − for the others; in the goal's currency. */
    amount: money('amount').notNull(),
    date: text('date').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('goal_allocations_goal').on(t.goalId), index('goal_allocations_account').on(t.accountId)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: id(),
    transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }),
    goalAllocationId: text('goal_allocation_id').references(() => goalAllocations.id, { onDelete: 'cascade' }),
    /** Relative to the app's attachments folder (absolute paths break on a new phone). */
    filePath: text('file_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      'attachments_one_owner',
      sql`(${t.transactionId} is null) <> (${t.goalAllocationId} is null)`,
    ),
  ],
);

// ── Rates, import, export ───────────────────────────────────────────────────

/** Current market rates only (no history). */
export const marketRates = sqliteTable(
  'market_rates',
  {
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: money('rate').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.base, t.quote] })],
);

export const importPresets = sqliteTable('import_presets', {
  id: id(),
  name: text('name').notNull(),
  /** Normalised CSV header row; a file whose headers match is mapped automatically. */
  headerSignature: text('header_signature').notNull(),
  /** CSV column → field. */
  columnMap: text('column_map', { mode: 'json' }).notNull(),
  ...timestamps,
});

/** Exported tax periods, for the "This changes October, which you exported" warning. */
export const taxExports = sqliteTable('tax_exports', {
  id: id(),
  fiscalYearStart: text('fiscal_year_start').notNull(),
  fiscalYearEnd: text('fiscal_year_end').notNull(),
  exportedAt: text('exported_at').notNull(),
  ...timestamps,
});
