-- Short, human-readable booking reference (e.g. PA-20261215-T74N) shown to
-- customers, in the admin dashboard and in Stripe. The uuid `id` remains the
-- key for every technical operation; the reference is display/lookup only.
alter table public.bookings add column reference text;

-- PA-<Hawaii booking date>-<4 chars>. The alphabet skips look-alikes (0/O, 1/I)
-- and has 32 letters, so byte % 32 is unbiased: ~1M codes per day.
create or replace function public.new_booking_reference()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code  text;
begin
  loop
    v_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    v_code := 'PA-' || to_char(now() at time zone 'Pacific/Honolulu', 'YYYYMMDD') || '-';
    for i in 0..3 loop
      v_code := v_code || substr(v_alphabet, get_byte(v_bytes, i) % 32 + 1, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where reference = v_code);
  end loop;
  return v_code;
end $$;

update public.bookings set reference = public.new_booking_reference() where reference is null;
alter table public.bookings
  alter column reference set default public.new_booking_reference(),
  alter column reference set not null;
-- The unique index is the final guard against a (very unlikely) concurrent collision.
create unique index bookings_reference_key on public.bookings (reference);

revoke execute on function public.new_booking_reference() from public, anon;
grant  execute on function public.new_booking_reference() to authenticated, service_role;
