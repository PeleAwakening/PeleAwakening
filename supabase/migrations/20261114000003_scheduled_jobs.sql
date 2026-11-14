-- Background jobs (pg_cron runs in UTC; Hawaii is UTC-10 year-round).
create extension if not exists pg_cron with schema pg_catalog;

-- 1:00 AM Hawaii: keep the booking window filled with upcoming sessions.
select cron.schedule('pa-generate-sessions', '0 11 * * *', $$select public.generate_sessions()$$);

-- Release spots held by abandoned checkouts.
select cron.schedule('pa-expire-holds', '*/10 * * * *', $$
  update public.bookings set status = 'expired'
   where status = 'pending' and hold_expires_at < now()
$$);
