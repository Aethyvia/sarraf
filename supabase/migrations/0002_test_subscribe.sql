-- Sarraf Plus before Google Play Billing is wired up (owner, Nov 12): "Subscribe" in the app
-- records the subscription for the signed-in user directly. Replace with the Play purchase
-- check (a server function using the service role) before release, and drop this function.
create or replace function public.test_subscribe(kind text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  renews timestamptz := now() + case when kind = 'yearly' then interval '1 year' else interval '1 month' end;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if kind not in ('monthly', 'yearly') then
    raise exception 'Unknown plan %', kind;
  end if;
  insert into public.subscriptions (user_id, plan, renews_at, source, updated_at)
  values (auth.uid(), 'plus', renews, 'test', now())
  on conflict (user_id) do update set plan = 'plus', renews_at = excluded.renews_at, source = 'test', updated_at = now();
  return renews;
end;
$$;

revoke all on function public.test_subscribe(text) from public, anon;
grant execute on function public.test_subscribe(text) to authenticated;
