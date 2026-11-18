-- Evening Tai Chi (Fundamentals & Technique) moves to Monday and Wednesday,
-- 5:00-6:30 PM Hawaii time. Upcoming sessions move with it, bookings included,
-- except sessions an admin customized individually.
update public.schedule_rules r
   set start_time = '17:00', end_time = '18:30'
  from public.class_types ct
 where ct.id = r.class_type_id
   and ct.slug = 'tai-chi-fundamentals';

update public.class_sessions s
   set starts_at = (((s.starts_at at time zone 'Pacific/Honolulu')::date + r.start_time) at time zone 'Pacific/Honolulu'),
       ends_at   = (((s.starts_at at time zone 'Pacific/Honolulu')::date + r.end_time)   at time zone 'Pacific/Honolulu')
  from public.schedule_rules r
  join public.class_types ct on ct.id = r.class_type_id
 where s.schedule_rule_id = r.id
   and ct.slug = 'tai-chi-fundamentals'
   and not s.customized
   and s.starts_at > now();
