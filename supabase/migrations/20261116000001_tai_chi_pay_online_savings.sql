-- Tai Chi pricing: paying online is $5 less than paying at class.
--   Morning (Yang, Chen practice): $10 online, $15 at class
--   Evening (Fundamentals & Technique): $25 online, $30 at class
-- The free 60+ option is unchanged. Existing bookings keep the price they
-- were booked at (bookings store their own unit and total amounts).
update public.price_options po
   set amount_cents = v.amount_cents
  from (values
    ('tai-chi-yang',         'online',    1000),
    ('tai-chi-yang',         'in_person', 1500),
    ('tai-chi-chen',         'online',    1000),
    ('tai-chi-chen',         'in_person', 1500),
    ('tai-chi-fundamentals', 'online',    2500),
    ('tai-chi-fundamentals', 'in_person', 3000)
  ) as v (slug, kind, amount_cents),
  public.class_types ct
 where ct.slug = v.slug
   and po.class_type_id = ct.id
   and po.kind = v.kind;
