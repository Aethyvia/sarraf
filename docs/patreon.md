# Patreon supporters

Two rewards. Give either or both, depending on the tier.

## 1. Sarraf Plus for life

### Once: set up Supabase

Run these in the Supabase SQL editor (Supabase → SQL editor → New query → paste the file → Run), in order. Each only needs running once.

| File | What it adds |
| --- | --- |
| `supabase/migrations/0003_supporters.sql` | Supporter emails and codes |
| `supabase/migrations/0005_supporter_code_maker.sql` | Making codes in bulk |
| `supabase/migrations/0006_supporter_code_revoke_expiry.sql` | Use-by dates and revoking |
| `supabase/migrations/0007_supporter_code_cleanup.sql` | Daily removal of dead codes |

### By email

The supporter tells you the email they sign in to Sarraf with:

```sql
insert into public.supporter_emails (email, note) values ('someone@gmail.com', 'Patreon, Gold');
```

The next time their app checks the plan (every time it opens), they get Plus for life. It works whether they sign up before or after you add them.

### By code

They don't have to share an email. Make codes, then send one to each supporter (Patreon message):

```sql
-- 10 codes with no deadline
select * from public.make_supporter_codes(10, 'Patreon, Silver, Nov 2026');

-- 10 codes that must be used by a date
select * from public.make_supporter_codes(10, 'Patreon, Silver, Nov 2026', '2026-12-31');
```

Codes look like `SARRAF-K7QM-2XWD` (no 0/O or 1/I, so they can't be misread). The note is only for you: tier and month. Keep the list somewhere private.

They enter it in **Settings → Subscription → Have a code?** while signed in to a Sarraf account (a guest can't use a code). Each code works once. A use-by date only limits when a code can first be used; once used, it gives Plus for life.

What they see:

| Situation | Message |
| --- | --- |
| Code works | "You're on Sarraf Plus for life. Thank you for your support!" |
| Someone else already used it | "That code has already been used." |
| Past its use-by date | "That code has expired." |
| Wrong, revoked or removed | "That code isn't right. Check it and try again." |

After that, their Subscription page shows only a tick, **Sarraf Plus** and **Active for life**: no prices, no buttons. Lifetime Plus works offline for good. The app never mentions Patreon.

### Change a code's deadline

```sql
update public.supporter_codes set expires_at = '2027-01-31' where code = 'SARRAF-K7QM-2XWD';
update public.supporter_codes set expires_at = null where code = 'SARRAF-K7QM-2XWD';  -- no deadline
```

### Revoke a code

For example, a supporter cancelled or a code leaked:

```sql
select public.revoke_supporter_code('SARRAF-K7QM-2XWD');
```

It tells you what happened:
- **Never used:** the code stops working.
- **Used:** that person's lifetime Plus from it ends. Their app sees it the next time it opens, then the normal "Sarraf Plus has ended" flow applies: nothing is deleted, they choose what stays active.
- If they're also on the supporter email list, their Plus stays. A paid Google Play subscription is never touched.

Undo within 30 days:

```sql
update public.supporter_codes set revoked_at = null where code = 'SARRAF-K7QM-2XWD';
```

If that code had been used, this keeps the code but doesn't give the person their Plus back. Also run `select public.grant_lifetime('<their user id>');`; the user id is the code's `redeemed_by`.

### Automatic cleanup

Every day at 01:00 UTC, Supabase deletes:
- never-used codes 30 days after their use-by date;
- revoked codes 30 days after you revoked them.

Used codes that weren't revoked are kept: they're the record that a code was spent.

```sql
select public.remove_dead_supporter_codes();      -- clean up now
select public.remove_dead_supporter_codes(0);     -- clean up now, no 30-day wait
select cron.unschedule('remove-dead-supporter-codes');  -- turn automatic cleanup off
```

### Useful checks

```sql
-- every code, newest first
select code, note, expires_at, redeemed_at, revoked_at from public.supporter_codes order by added_at desc;
-- not used yet
select code, note, expires_at from public.supporter_codes where redeemed_by is null and revoked_at is null order by added_at;
-- used, and when
select code, note, redeemed_at from public.supporter_codes where redeemed_by is not null;
```

## 2. New versions before everyone else

No app change needed. In Google Play Console:

1. Testing → **Closed testing** → Create track, for example "Supporters".
2. Testers → create an email list (or use a Google Group) and add supporters' Google Play emails.
3. Copy the **opt-in link** and post it for that tier on Patreon.
4. Release each new version to the Supporters track first, then to Production a few days later.

Supporters who opt in get updates from the Supporters track automatically.
