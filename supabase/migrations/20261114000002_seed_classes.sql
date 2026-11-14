-- Initial classes, schedule and prices, matching the current website.
-- Everything here is editable afterwards in /admin.
do $$
declare
  v_magic_island uuid;
  v_wang         uuid;
  v_may          uuid;
  v_yang         uuid;
  v_chen         uuid;
  v_evening      uuid;
begin
  insert into public.locations (name, address, maps_url, notes)
  values ('Magic Island, O''ahu', '1365 Ala Moana Blvd, Honolulu, HI 96814',
          'https://maps.app.goo.gl/fqYjeTaYJJL6pViU6', 'Outdoor class at Ala Moana Beach Park')
  returning id into v_magic_island;

  insert into public.instructors (name) values ('Wang Guolong') returning id into v_wang;
  insert into public.instructors (name) values ('May') returning id into v_may;

  insert into public.class_types (slug, name, description, detail_url, location_id, instructor_id, default_capacity, sort_order)
  values ('tai-chi-yang', 'Tai Chi Yang Practice',
          'Slow, flowing movement as the island wakes. All levels welcome.',
          '/experiences/tai-chi.html', v_magic_island, v_wang, 20, 1)
  returning id into v_yang;

  insert into public.class_types (slug, name, description, detail_url, location_id, instructor_id, default_capacity, sort_order)
  values ('tai-chi-chen', 'Tai Chi Chen Practice',
          'Rooted, spiraling movement, the original form of Tai Chi. All levels welcome.',
          '/experiences/tai-chi-chen.html', v_magic_island, v_may, 20, 2)
  returning id into v_chen;

  insert into public.class_types (slug, name, description, detail_url, location_id, instructor_id, default_capacity, sort_order)
  values ('tai-chi-kung-fu-evening', 'Tai Chi and Kung Fu Fundamentals',
          'Evening training covering both Tai Chi and Kung Fu. All levels welcome.',
          '/experiences/kung-fu.html', v_magic_island, v_wang, 20, 3)
  returning id into v_evening;

  -- Weekly schedule (Hawaii time). weekday: 0 = Sunday … 6 = Saturday
  insert into public.schedule_rules (class_type_id, weekday, start_time, end_time) values
    (v_yang,    3, '08:00', '09:30'),  -- Wednesday
    (v_yang,    5, '08:00', '09:30'),  -- Friday
    (v_chen,    4, '08:00', '09:30'),  -- Thursday
    (v_chen,    6, '08:00', '09:30'),  -- Saturday
    (v_evening, 1, '17:30', '19:00'),  -- Monday
    (v_evening, 3, '17:30', '19:00');  -- Wednesday

  -- MVP pricing: $10 per morning class, $30 per evening class, online or at
  -- class. Free (Age 60+) is attached to the Yang class, which meets
  -- Wednesday and Friday mornings only.
  -- "online" options stay hidden until online payments are approved.
  insert into public.price_options (class_type_id, label, kind, amount_cents, eligibility_note, sort_order) values
    (v_yang,    'Book & Pay Online',          'online',    1000, 'Secure payment by Stripe', 1),
    (v_yang,    'Reserve Now, Pay at Class',  'in_person', 1000, 'Cash or card at Magic Island', 2),
    (v_yang,    'Free (Age 60+)',             'free',         0, 'Wednesday & Friday mornings, honor system', 3),
    (v_chen,    'Book & Pay Online',          'online',    1000, 'Secure payment by Stripe', 1),
    (v_chen,    'Reserve Now, Pay at Class',  'in_person', 1000, 'Cash or card at Magic Island', 2),
    (v_evening, 'Book & Pay Online',          'online',    3000, 'Secure payment by Stripe', 1),
    (v_evening, 'Reserve Now, Pay at Class',  'in_person', 3000, 'Cash or card at Magic Island', 2);

  -- Passes from the current pricing pages. Not part of the MVP: inactive and
  -- not shown in the admin interface, kept for a later membership feature.
  insert into public.membership_plans (class_type_id, name, kind, price_cents, class_count, duration_days) values
    (v_yang,    'Tai Chi Yang · Unlimited for 1 Year', 'annual',     15000, null, 365),
    (v_chen,    'Tai Chi Chen · Unlimited per Month',  'monthly',     5000, null,  30),
    (v_evening, 'Evening Class · 8 Classes per Month', 'class_pack', 15000,    8,  30);
end $$;

select public.generate_sessions();
