-- Supporter codes: revoke a code, and give a code a "redeem by" date (owner, Nov 20).
-- Run once in the SQL editor (after 0003 and 0005). Then, any time:
--
--   Make codes that must be used by a date:
--     select * from public.make_supporter_codes(10, 'Patreon, Silver', '2026-12-31');
--   Make codes with no deadline (as before):
--     select * from public.make_supporter_codes(10, 'Patreon, Silver');
--   Change one code's deadline (or clear it with null):
--     update public.supporter_codes set expires_at = '2027-01-31' where code = 'SARRAF-K7QM-2XWD';
--   Revoke a code (an unused one stops working; a used one also ends that person's Plus from it):
--     select public.revoke_supporter_code('SARRAF-K7QM-2XWD');
--   See your codes:
--     select code, note, expires_at, redeemed_at, revoked_at from public.supporter_codes order by added_at desc;
--
-- A code still gives lifetime Plus when it's used (Decided Nov 14); the date only limits WHEN it can be used.

alter table public.supporter_codes add column if not exists expires_at timestamptz;
alter table public.supporter_codes add column if not exists revoked_at timestamptz;

-- The 2-argument maker becomes a 3-argument one with an optional deadline.
drop function if exists public.make_supporter_codes(int, text);
create or replace function public.make_supporter_codes(how_many int, note text, use_by timestamptz default null)
returns setof text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
  made int := 0;
begin
  if how_many < 1 or how_many > 500 then
    raise exception 'Make between 1 and 500 codes at a time';
  end if;
  if use_by is not null and use_by <= now() then
    raise exception 'The use-by date has to be in the future';
  end if;
  while made < how_many loop
    bytes := extensions.gen_random_bytes(8);
    code := 'SARRAF-';
    for i in 0..7 loop
      if i = 4 then code := code || '-'; end if;
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    insert into public.supporter_codes (code, note, expires_at) values (code, note, use_by) on conflict do nothing;
    if found then
      made := made + 1;
      return next code;
    end if;
  end loop;
end;
$$;
revoke all on function public.make_supporter_codes(int, text, timestamptz) from public, anon, authenticated;

-- "Have a code?": returns 'ok', 'used', 'expired' or 'unknown' (a revoked code reads as unknown).
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
  if not found or row.revoked_at is not null then
    return 'unknown';
  end if;
  if row.redeemed_by is not null and row.redeemed_by <> me then
    return 'used';
  end if;
  -- The deadline is for first use; the person who already used it can enter it again.
  if row.redeemed_by is null and row.expires_at is not null and row.expires_at < now() then
    return 'expired';
  end if;
  update public.supporter_codes set redeemed_by = me, redeemed_at = coalesce(redeemed_at, now()) where supporter_codes.code = row.code;
  perform public.grant_lifetime(me);
  return 'ok';
end;
$$;
revoke all on function public.redeem_supporter_code(text) from public, anon;
grant execute on function public.redeem_supporter_code(text) to authenticated;

-- Owner only. Stops a code working. If someone already used it, their lifetime Plus from it ends too,
-- unless they're also on the supporter email list (that grant stays). A paid Play subscription is never touched.
-- Their app sees it at its next plan check; then the normal "Sarraf Plus has ended" flow applies (nothing deleted).
create or replace function public.revoke_supporter_code(code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.supporter_codes%rowtype;
  who_email text;
begin
  select * into row from public.supporter_codes where upper(supporter_codes.code) = upper(trim(revoke_supporter_code.code)) for update;
  if not found then
    return 'no such code';
  end if;
  update public.supporter_codes set revoked_at = coalesce(revoked_at, now()) where supporter_codes.code = row.code;
  if row.redeemed_by is null then
    return 'revoked (it was never used)';
  end if;
  select lower(email) into who_email from auth.users where id = row.redeemed_by;
  if who_email is not null and exists (select 1 from public.supporter_emails where lower(email) = who_email) then
    return 'revoked; their Plus stays because their email is on the supporter list';
  end if;
  delete from public.subscriptions where user_id = row.redeemed_by and source = 'supporter';
  return 'revoked; their lifetime Plus from this code has ended';
end;
$$;
revoke all on function public.revoke_supporter_code(text) from public, anon, authenticated;
