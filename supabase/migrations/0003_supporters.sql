-- Patreon supporters (owner, Nov 14): lifetime Sarraf Plus, given either way, by tier.
--   A) By email: add the supporter's sign-in email to supporter_emails. The next time
--      their app checks the plan, they get lifetime Plus (signed up already or later).
--   B) By code: add a code to supporter_codes and send it to them. They enter it once
--      in Sarraf (Settings → Subscription → "Have a code?").
-- Lifetime Plus = a subscriptions row with source 'supporter' and no renews_at.
-- Only the owner (service role / SQL editor) can add emails or codes; the app can't read them.

create table if not exists public.supporter_emails (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);

create table if not exists public.supporter_codes (
  code         text primary key,
  note         text,
  added_at     timestamptz not null default now(),
  redeemed_by  uuid references auth.users (id) on delete set null,
  redeemed_at  timestamptz
);

alter table public.supporter_emails enable row level security;
alter table public.supporter_codes enable row level security;
-- No policies: nobody but the service role reads or writes these tables.

create or replace function public.grant_lifetime(uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.subscriptions (user_id, plan, renews_at, source, updated_at)
  values (uid, 'plus', null, 'supporter', now())
  on conflict (user_id) do update set plan = 'plus', renews_at = null, source = 'supporter', updated_at = now();
$$;
revoke all on function public.grant_lifetime(uuid) from public, anon, authenticated;

-- Called by the app when it checks the plan: a listed email gets lifetime Plus.
create or replace function public.claim_supporter()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
begin
  if me is null then
    return false;
  end if;
  select lower(email) into my_email from auth.users where id = me;
  if my_email is null or not exists (select 1 from public.supporter_emails where lower(email) = my_email) then
    return false;
  end if;
  perform public.grant_lifetime(me);
  return true;
end;
$$;
revoke all on function public.claim_supporter() from public, anon;
grant execute on function public.claim_supporter() to authenticated;

-- "Have a code?": a code works once. Returns 'ok', 'used' or 'unknown'.
create or replace function public.redeem_supporter_code(code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.supporter_codes%rowtype;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into row from public.supporter_codes where upper(supporter_codes.code) = upper(trim(redeem_supporter_code.code)) for update;
  if not found then
    return 'unknown';
  end if;
  if row.redeemed_by is not null and row.redeemed_by <> me then
    return 'used';
  end if;
  update public.supporter_codes set redeemed_by = me, redeemed_at = coalesce(redeemed_at, now()) where supporter_codes.code = row.code;
  perform public.grant_lifetime(me);
  return 'ok';
end;
$$;
revoke all on function public.redeem_supporter_code(text) from public, anon;
grant execute on function public.redeem_supporter_code(text) to authenticated;

-- Examples (run in the SQL editor):
--   insert into public.supporter_emails (email, note) values ('someone@gmail.com', 'Patreon, Gold');
--   insert into public.supporter_codes (code, note) values ('SARRAF-7KQ2-9XWD', 'Patreon, Silver');
