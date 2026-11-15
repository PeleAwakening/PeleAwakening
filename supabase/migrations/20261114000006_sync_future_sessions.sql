-- Sessions copy capacity, location and instructor when they are generated, so
-- editing a class or weekly rule used to affect only sessions generated later.
-- Now upcoming sessions follow such edits immediately, except sessions an admin
-- customized individually. Existing bookings are kept; if more spots are taken
-- than the new capacity, the session simply shows as full.
create or replace function public.sync_future_sessions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.class_sessions s
     set capacity      = coalesce(r.capacity, ct.default_capacity),
         location_id   = coalesce(r.location_id, ct.location_id),
         instructor_id = coalesce(r.instructor_id, ct.instructor_id)
    from public.schedule_rules r
    join public.class_types ct on ct.id = r.class_type_id
   where s.schedule_rule_id = r.id
     and not s.customized
     and s.starts_at > now()
     and case tg_table_name
           when 'class_types' then ct.id = new.id
           else r.id = new.id
         end;
  return null;
end $$;

create trigger class_types_sync_sessions
  after update of default_capacity, location_id, instructor_id on public.class_types
  for each row execute function public.sync_future_sessions();

create trigger schedule_rules_sync_sessions
  after update of capacity, location_id, instructor_id on public.schedule_rules
  for each row execute function public.sync_future_sessions();

revoke execute on function public.sync_future_sessions() from public, anon, authenticated;

-- Apply edits already made before this migration.
update public.class_sessions s
   set capacity      = coalesce(r.capacity, ct.default_capacity),
       location_id   = coalesce(r.location_id, ct.location_id),
       instructor_id = coalesce(r.instructor_id, ct.instructor_id)
  from public.schedule_rules r
  join public.class_types ct on ct.id = r.class_type_id
 where s.schedule_rule_id = r.id
   and not s.customized
   and s.starts_at > now();
