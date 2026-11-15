-- Explicit table privileges. Newer Supabase projects no longer grant
-- SELECT/INSERT/UPDATE/DELETE on new public tables to the API roles, so
-- nothing works until they are granted. Access is still decided by RLS:
--   service_role  Edge Functions only (bypasses RLS, never in the browser)
--   authenticated the /admin page; every policy requires public.is_admin()
--   anon          no table access at all (public data comes from functions)
grant select, insert, update, delete on all tables in schema public to service_role;

grant select, insert, update, delete on
  public.settings, public.locations, public.instructors, public.class_types,
  public.price_options, public.membership_plans, public.schedule_rules,
  public.class_sessions, public.customers, public.memberships,
  public.bookings, public.payments, public.inquiries
  to authenticated;
grant select on public.admins to authenticated;
-- public.stripe_events: service_role only.

revoke all on all tables in schema public from anon;
