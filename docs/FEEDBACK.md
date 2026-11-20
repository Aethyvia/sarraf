# Owner feedback — to do (recorded 2026-11-11, not applied yet)

- [x] Account detail: the balance graph doesn't change when tapping 6M or 1Y. Same problem on Analytics.
- [x] People: add a way to settle between currencies (e.g. owe in USD, settle in PKR).
- [x] Calculator (keypad with + − × ÷) on every amount field — done Nov 12 (patterns A/B1/C/D, see DECISIONS).
- [x] Recurring add/edit is missing the calculator — done Nov 12.
- [x] Home → Recurring: the "Auto" tag should be the same shape and size as the "Paid" button.
- [x] Review page: action buttons should all be the same size.
- [x] Analytics: the "This year" range label doesn't say what it covers.
- [x] Review page: remove the ⋯ button; tapping the row opens the details.

# Owner feedback — recorded 2026-11-20, to do on the next app session

- [ ] Home: the default currency's tile comes first and is big, filling the whole first row; the other currencies follow in the usual two-column tiles (Reorder currencies still orders the rest). The big tile shows the balance, Usable, In / Out for the month, and a small 30-day balance trend line beside the amount (owner picked only the trend line from: money in goals, budget, upcoming, trend).
- [x] Home currency cards: remove the "spent · back" line (owner, Nov 20; replaces the Nov 14 decision). Out stays as spending after money back; refunds/reimbursements still show under their expense in Transactions.
- [ ] Hide amounts: an eye button in the header of every main tab — Home, Transactions, Analytics, Savings — (eye when amounts show, eye-off when hidden); tapping it turns Hide amounts on or off everywhere, same as the Settings switch. Remove tap-to-peek on single amounts (owner: small amounts are too hard to hit, and Analytics had no way to show its numbers). Detail screens follow the setting.
- [ ] People: a profile picture per person (owner, Nov 20). Camera or gallery, cropped square and shrunk (like photo attachments), stored on the phone encrypted with the attachment key, included in the encrypted Drive backup and in JSON export/import by the person's id. Shown wherever the person's initials circle is today (People list, person page, pickers, splits, Settle up); initials stay the default. Change or remove from Edit person.
- [x] Transaction detail: show "Mark as cancelled" only for Pending, In transit, Upcoming, or an auto-added recurring item not yet confirmed (owner, Nov 20: a processed payment can't be cancelled). Processed rows keep Edit, Delete (with Undo), Add refund / Got it back; already-cancelled rows keep Restore. Today the button shows on every editable row (`src/app/transaction/[id]/index.tsx`). Add a test that cancelTransaction refuses a cleared, confirmed row.
- [x] Year ranges (owner, Nov 20): every range picker offers both **This year** (Jan 1 – today) and **This fiscal year** (from the fiscal year's start, e.g. Jul 1) — Transactions' Dates filter, Analytics' range, Export's date range and What converting cost you. When the fiscal year is Jan – Dec, only "This year" shows (they'd be the same). Remove the Settings switch "Use my fiscal year for 'This year'" and its migration of the stored preference. Fiscal year start stays in Settings (tax export and budgets unchanged).
