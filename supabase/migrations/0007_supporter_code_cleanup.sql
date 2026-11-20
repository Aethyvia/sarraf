-- Auto-remove dead supporter codes (owner, Nov 20). Run once in the SQL editor, after 0006.
-- Every day at 01:00 UTC it deletes:
--   • codes that were never used and whose use-by date passed more than 30 days ago;
--   • revoked codes, 30 days after they were revoked.
-- Used codes that weren't revoked are kept: they're the record that a code was spent,
-- and they make the same code say "already used" to anyone else.
-- The 30 days give you time to look back or undo a revoke (update ... set revoked_at = null)
-- before the row disappears. A deleted code just reads as "That code isn't right." in the app.
--
-- Run the cleanup now by hand:   select public.remove_dead_supporter_codes();
-- See the job:                   select jobname, schedule, active from cron.job;
-- Stop the job:                  select cron.unschedule('remove-dead-supporter-codes');

create extension if not exists pg_cron;

create or replace function public.remove_dead_supporter_codes(keep_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from public.supporter_codes
  where (redeemed_by is null and expires_at is not null and expires_at < now() - make_interval(days => keep_days))
     or (revoked_at is not null and revoked_at < now() - make_interval(days => keep_days));
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.remove_dead_supporter_codes(int) from public, anon, authenticated;

select cron.unschedule('remove-dead-supporter-codes') where exists (select 1 from cron.job where jobname = 'remove-dead-supporter-codes');
select cron.schedule('remove-dead-supporter-codes', '0 1 * * *', 'select public.remove_dead_supporter_codes()');
