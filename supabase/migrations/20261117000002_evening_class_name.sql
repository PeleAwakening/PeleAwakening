-- The evening class covers both Tai Chi and Kung Fu. The slug stays
-- 'tai-chi-fundamentals' so existing links (/schedule/?class=…) keep working.
-- Existing bookings show the new name too (they reference the class).
update public.class_types
   set name = 'Evening Tai Chi & Kung Fu',
       description = 'An evening class covering Tai Chi and Kung Fu fundamentals: detailed movement instruction, posture correction, body alignment, and technique refinement.'
 where slug = 'tai-chi-fundamentals';
