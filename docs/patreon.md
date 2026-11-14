# Patreon supporters

Two rewards. Give either or both, depending on the tier.

## 1. Sarraf Plus for life

First, once: run `supabase/migrations/0003_supporters.sql` in the Supabase SQL editor.

**By email** (the supporter tells you the email they sign in to Sarraf with):

```sql
insert into public.supporter_emails (email, note) values ('someone@gmail.com', 'Patreon, Gold');
```

The next time their app checks the plan (on open, or Settings → Subscription → Restore purchase), they get Plus for life. It works if they sign up before or after you add them.

**By code** (they don't have to share an email):

```sql
insert into public.supporter_codes (code, note) values ('SARRAF-7KQ2-9XWD', 'Patreon, Silver');
```

Send them the code. They open Settings → Subscription → **Have a code?** and enter it. Each code works once. To see who used which: `select * from public.supporter_codes;`

Lifetime Plus works offline forever and shows as "Your plan · Lifetime". The app never mentions Patreon.

## 2. New versions before everyone else

No app change needed. In Google Play Console:

1. Testing → **Closed testing** → Create track, for example "Supporters".
2. Testers → create an email list (or use a Google Group) and add supporters' Google Play emails.
3. Copy the **opt-in link** and post it for that tier on Patreon.
4. Release each new version to the Supporters track first, then to Production a few days later.

Supporters who opt in get updates from the Supporters track automatically.
