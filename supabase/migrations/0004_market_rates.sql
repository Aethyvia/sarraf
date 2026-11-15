-- Market rates through Supabase (owner, Nov 15): Supabase fetches the day's rates once,
-- and every phone reads them from here instead of calling the rates provider itself.
-- Only currency rates are stored; nothing about anyone's money is sent or kept.
--
-- Run this whole file once in the SQL editor. If "create extension" fails, turn on
-- pg_cron and http in Dashboard → Database → Extensions, then run it again.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- One row per base currency (Sarraf uses USD). `rates` is the provider's map, e.g. {"PKR": 278.1, ...}.
create table if not exists public.market_rates (
  base         text primary key,
  rates        jsonb not null,
  fetched_at   timestamptz not null default now(),
  provider_at  timestamptz,
  source       text not null default 'ExchangeRate-API (open.er-api.com)'
);

alter table public.market_rates enable row level security;

-- Anyone using the app can read rates (guests too, with the public key); nobody can write.
drop policy if exists "market rates are readable" on public.market_rates;
create policy "market rates are readable" on public.market_rates for select to anon, authenticated using (true);

-- Fetches the latest USD rates and stores them. Keeps the previous rates if the fetch fails.
create or replace function public.refresh_market_rates()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  res  extensions.http_response;
  body jsonb;
begin
  select * into res from extensions.http_get('https://open.er-api.com/v6/latest/USD');
  if res.status <> 200 then
    return 'http ' || res.status;
  end if;
  body := res.content::jsonb;
  if body->>'result' <> 'success' or jsonb_typeof(body->'rates') <> 'object' then
    return 'bad response';
  end if;
  insert into public.market_rates (base, rates, fetched_at, provider_at)
  values (
    'USD',
    body->'rates',
    now(),
    to_timestamp((body->>'time_last_update_unix')::bigint)
  )
  on conflict (base) do update
    set rates = excluded.rates, fetched_at = excluded.fetched_at, provider_at = excluded.provider_at;
  return 'ok';
end;
$$;

revoke all on function public.refresh_market_rates() from public, anon, authenticated;

-- Once a day at 00:30 UTC (the provider updates once a day).
select cron.unschedule('refresh-market-rates') where exists (select 1 from cron.job where jobname = 'refresh-market-rates');
select cron.schedule('refresh-market-rates', '30 0 * * *', 'select public.refresh_market_rates()');

-- Fill it now, so the app has rates straight away. Should return 'ok'.
select public.refresh_market_rates();
