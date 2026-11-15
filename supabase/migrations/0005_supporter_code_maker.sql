-- Making Patreon supporter codes in bulk (owner, Nov 15). Run once in the SQL editor.
-- Then, any time:  select * from public.make_supporter_codes(10, 'Patreon, Silver');
-- Codes look like SARRAF-K7QM-2XWD: letters and digits that can't be confused (no 0/O, 1/I).
-- 32 characters, so each pick is unbiased; 8 picks = 40 random bits per code.

create or replace function public.make_supporter_codes(how_many int, note text)
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
  while made < how_many loop
    bytes := extensions.gen_random_bytes(8);
    code := 'SARRAF-';
    for i in 0..7 loop
      if i = 4 then code := code || '-'; end if;
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    insert into public.supporter_codes (code, note) values (code, note) on conflict do nothing;
    if found then
      made := made + 1;
      return next code;
    end if;
  end loop;
end;
$$;

-- Only you (SQL editor / service role) can make codes; the app can't.
revoke all on function public.make_supporter_codes(int, text) from public, anon, authenticated;
