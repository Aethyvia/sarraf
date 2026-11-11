-- Sarraf: the only data kept on the server (CLAUDE.md, Schema — Decided).
-- No money data: just where the backup is and a few counts, and the subscription.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run twice.

-- ── Backup record: one row per Sarraf account ─────────────────────────────
create table if not exists public.backup_records (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  drive_email    text        not null,
  last_backup_at timestamptz not null,
  device_id      text        not null,   -- the phone that makes backups; another phone restoring takes this over
  device_name    text        not null,
  size_bytes     bigint      not null check (size_bytes >= 0),
  counts         jsonb       not null default '{}'::jsonb,  -- e.g. {"accounts":6,"transactions":120}, never amounts
  format         integer     not null,
  updated_at     timestamptz not null default now()
);

alter table public.backup_records enable row level security;

drop policy if exists "own backup record: read"   on public.backup_records;
drop policy if exists "own backup record: add"    on public.backup_records;
drop policy if exists "own backup record: change" on public.backup_records;
drop policy if exists "own backup record: remove" on public.backup_records;
create policy "own backup record: read"   on public.backup_records for select to authenticated using ((select auth.uid()) = user_id);
create policy "own backup record: add"    on public.backup_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own backup record: change" on public.backup_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own backup record: remove" on public.backup_records for delete to authenticated using ((select auth.uid()) = user_id);

-- ── Subscription: Sarraf Plus. The app only reads it; the store webhook writes it (service role). ──
create table if not exists public.subscriptions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  plan       text        not null check (plan in ('plus')),
  renews_at  timestamptz,
  source     text        not null default 'google_play',
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "own subscription: read" on public.subscriptions;
create policy "own subscription: read" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- ── Delete Sarraf account: removes the sign-in; the two rows above go with it (on delete cascade). ──
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
