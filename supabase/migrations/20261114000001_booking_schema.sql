-- ============================================
-- Pele Awakening — booking, payments, customers
-- All class times are Hawaii time (Pacific/Honolulu).
-- Nothing in this schema is readable by anonymous visitors except
-- through get_public_schedule(); every table has RLS enabled.
-- ============================================

-- ---- Helpers ----
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---- Admins (Supabase Auth users allowed into /admin) ----
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---- Site-wide booking settings (single row) ----
create table public.settings (
  id                      boolean primary key default true check (id),
  cancellation_hours      integer not null default 24 check (cancellation_hours >= 0),
  cancellation_policy     text not null default 'Cancel at least 24 hours before class for a full refund. Walk-ins are welcome when space is available.',
  max_party_size          integer not null default 6 check (max_party_size between 1 and 50),
  booking_hold_minutes    integer not null default 35 check (booking_hold_minutes >= 31),
  booking_window_days     integer not null default 28 check (booking_window_days between 1 and 120),
  -- Shows "pay online" options on /schedule. Changed by SQL only, after pricing
  -- and Stripe configuration are approved; the server also refuses live keys
  -- unless ALLOW_LIVE_PAYMENTS=true.
  online_payments_enabled boolean not null default false,
  updated_at              timestamptz not null default now()
);
insert into public.settings default values;

-- ---- Catalog: locations, instructors, classes, prices ----
create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text,
  maps_url   text,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.instructors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  bio        text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.class_types (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name             text not null,
  description      text,
  detail_url       text,
  location_id      uuid references public.locations (id),
  instructor_id    uuid references public.instructors (id),
  default_capacity integer not null default 20 check (default_capacity > 0),
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.price_options (
  id               uuid primary key default gen_random_uuid(),
  class_type_id    uuid not null references public.class_types (id) on delete cascade,
  label            text not null,
  -- online: Stripe Checkout · free: confirmed with no payment · in_person: pay at class
  kind             text not null check (kind in ('online', 'free', 'in_person')),
  amount_cents     integer not null default 0 check (amount_cents >= 0),
  eligibility_note text,
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check (kind <> 'free' or amount_cents = 0)
);

-- Passes and memberships: stored now, sold online later.
create table public.membership_plans (
  id              uuid primary key default gen_random_uuid(),
  class_type_id   uuid references public.class_types (id) on delete set null,
  name            text not null,
  kind            text not null check (kind in ('class_pack', 'monthly', 'annual')),
  price_cents     integer not null check (price_cents >= 0),
  class_count     integer check (class_count > 0),
  duration_days   integer check (duration_days > 0),
  stripe_price_id text,
  active          boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ---- Schedule ----
-- Weekly template, in Hawaii local time. Sessions are generated from it.
create table public.schedule_rules (
  id            uuid primary key default gen_random_uuid(),
  class_type_id uuid not null references public.class_types (id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time    time not null,
  end_time      time not null,
  capacity      integer check (capacity > 0),          -- null: class default
  location_id   uuid references public.locations (id),   -- null: class default
  instructor_id uuid references public.instructors (id), -- null: class default
  valid_from    date not null default current_date,
  valid_until   date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (end_time > start_time)
);

create table public.class_sessions (
  id               uuid primary key default gen_random_uuid(),
  class_type_id    uuid not null references public.class_types (id) on delete cascade,
  schedule_rule_id uuid references public.schedule_rules (id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  capacity         integer not null check (capacity > 0),
  location_id      uuid references public.locations (id),
  instructor_id    uuid references public.instructors (id),
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  note             text,
  customized       boolean not null default false, -- edited by an admin; survives schedule rebuilds
  created_at       timestamptz not null default now(),
  unique (class_type_id, starts_at),
  check (ends_at > starts_at)
);
create index class_sessions_starts_at_idx on public.class_sessions (starts_at);

-- ---- Customers ----
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized   text generated always as (lower(btrim(email))) stored,
  name               text not null,
  phone              text,
  preferred_contact  text check (preferred_contact in ('email', 'text', 'phone')),
  interests          text[] not null default '{}',
  notes              text,
  stripe_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- One profile per email address (walk-ins without email are allowed).
create unique index customers_email_normalized_key on public.customers (email_normalized);
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

create table public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.customers (id) on delete cascade,
  plan_id                uuid references public.membership_plans (id),
  starts_on              date not null default current_date,
  ends_on                date,
  classes_remaining      integer check (classes_remaining >= 0),
  status                 text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  stripe_subscription_id text,
  notes                  text,
  created_at             timestamptz not null default now()
);

-- ---- Bookings & payments ----
create table public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.class_sessions (id) on delete restrict,
  customer_id        uuid not null references public.customers (id) on delete restrict,
  price_option_id    uuid references public.price_options (id) on delete set null,
  party_size         integer not null check (party_size between 1 and 50),
  unit_amount_cents  integer not null default 0,
  total_amount_cents integer not null default 0,
  payment_mode       text not null check (payment_mode in ('online', 'free', 'in_person', 'walk_in', 'membership')),
  status             text not null check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  source             text not null default 'web' check (source in ('web', 'admin', 'walk_in')),
  hold_expires_at    timestamptz,  -- pending online bookings hold spots until this time
  checked_in_at      timestamptz,
  attended_count     integer check (attended_count >= 0),
  cancelled_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- No double booking: one active booking per customer per session.
create unique index bookings_one_active_per_customer
  on public.bookings (session_id, customer_id) where status in ('pending', 'confirmed');
create index bookings_session_idx on public.bookings (session_id, status);
create index bookings_customer_idx on public.bookings (customer_id);
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- Card data never reaches us; only Stripe ids and amounts are stored.
create table public.payments (
  id                         uuid primary key default gen_random_uuid(),
  booking_id                 uuid references public.bookings (id) on delete set null,
  membership_id              uuid references public.memberships (id) on delete set null,
  provider                   text not null check (provider in ('stripe', 'cash', 'other')),
  kind                       text not null default 'class' check (kind in ('class', 'tip', 'membership')),
  amount_cents               integer not null check (amount_cents >= 0),
  refunded_amount_cents      integer not null default 0 check (refunded_amount_cents >= 0),
  currency                   text not null default 'usd',
  status                     text not null check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  refund_requested_at        timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_payment_intent_idx on public.payments (stripe_payment_intent_id);
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

-- Webhook idempotency: each Stripe event is processed once.
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- ---- Inquiries (contact form; FormSubmit history imported later) ----
create table public.inquiries (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references public.customers (id) on delete set null,
  name           text,
  email          text,
  phone          text,
  interest       text,
  message        text,
  contact_method text,
  source         text not null default 'web' check (source in ('web', 'formsubmit_import', 'admin')),
  received_at    timestamptz not null default now()
);

-- ============================================
-- Row Level Security: admins only. Anonymous visitors get no table access;
-- the Edge Functions use the service role, which bypasses RLS server-side.
-- ============================================
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'locations', 'instructors', 'class_types', 'price_options',
    'membership_plans', 'schedule_rules', 'class_sessions', 'customers',
    'memberships', 'bookings', 'payments', 'inquiries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "admins manage %1$s" on public.%1$I for all to authenticated '
      'using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

alter table public.admins enable row level security;
create policy "admins read admins" on public.admins for select to authenticated
  using (public.is_admin());

alter table public.stripe_events enable row level security; -- service role only

revoke all on all tables in schema public from anon;

-- ============================================
-- Functions
-- ============================================

-- Find-or-create a customer by normalized email. Never overwrites existing
-- details with what an anonymous visitor typed; only fills blanks.
create or replace function public.upsert_customer(
  p_email text, p_name text, p_phone text, p_contact text, p_interests text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.customers as c (email, name, phone, preferred_contact, interests)
  values (btrim(p_email), btrim(p_name), nullif(btrim(p_phone), ''), p_contact, coalesce(p_interests, '{}'))
  on conflict (email_normalized) do update set
    name              = coalesce(nullif(c.name, ''), excluded.name),
    phone             = coalesce(c.phone, excluded.phone),
    preferred_contact = coalesce(c.preferred_contact, excluded.preferred_contact),
    interests         = array(select distinct x from unnest(c.interests || excluded.interests) x)
  returning id into v_id;
  return v_id;
end $$;

-- Reserve spots atomically. The session row lock serializes concurrent
-- reservations, so capacity can never be exceeded.
create or replace function public.reserve_spots(
  p_session_id      uuid,
  p_customer_id     uuid,
  p_price_option_id uuid,
  p_party_size      integer,
  p_status          text,     -- 'pending' (awaiting payment) or 'confirmed'
  p_payment_mode    text,
  p_source          text,
  p_hold_minutes    integer,
  p_enforce_cutoff  boolean   -- web bookings close at class start
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare
  v_session public.class_sessions;
  v_option  public.price_options;
  v_taken   integer;
  v_booking public.bookings;
begin
  if p_status not in ('pending', 'confirmed') then
    raise exception 'invalid_status';
  end if;

  select * into v_session from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_unavailable'; end if;
  if p_enforce_cutoff and v_session.starts_at <= now() then raise exception 'session_started'; end if;

  if p_price_option_id is not null then
    select * into v_option from public.price_options
     where id = p_price_option_id and class_type_id = v_session.class_type_id and active;
    if not found then raise exception 'invalid_price_option'; end if;
  end if;

  -- A retry after an abandoned checkout replaces the customer's own pending hold.
  update public.bookings set status = 'expired'
   where session_id = v_session.id and customer_id = p_customer_id and status = 'pending';

  if exists (select 1 from public.bookings
              where session_id = v_session.id and customer_id = p_customer_id and status = 'confirmed') then
    raise exception 'already_booked';
  end if;

  select coalesce(sum(party_size), 0) into v_taken from public.bookings
   where session_id = v_session.id
     and (status = 'confirmed' or (status = 'pending' and hold_expires_at > now()));

  if v_taken + p_party_size > v_session.capacity then
    raise exception 'not_enough_spots' using detail = greatest(v_session.capacity - v_taken, 0)::text;
  end if;

  insert into public.bookings (
    session_id, customer_id, price_option_id, party_size, unit_amount_cents, total_amount_cents,
    payment_mode, status, source, hold_expires_at
  ) values (
    v_session.id, p_customer_id, p_price_option_id, p_party_size,
    coalesce(v_option.amount_cents, 0), coalesce(v_option.amount_cents, 0) * p_party_size,
    p_payment_mode, p_status, p_source,
    case when p_status = 'pending' then now() + make_interval(mins => p_hold_minutes) end
  ) returning * into v_booking;

  return v_booking;
end $$;

-- Admin: register a walk-in (checked in immediately; capacity still enforced).
create or replace function public.admin_add_walkin(
  p_session_id uuid, p_name text, p_email text, p_phone text,
  p_party_size integer, p_price_option_id uuid, p_cash_cents integer default 0
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_booking  public.bookings;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  if nullif(btrim(p_email), '') is not null then
    v_customer := public.upsert_customer(p_email, p_name, p_phone, null, '{}');
  else
    insert into public.customers (name, phone) values (btrim(p_name), nullif(btrim(p_phone), ''))
    returning id into v_customer;
  end if;

  v_booking := public.reserve_spots(p_session_id, v_customer, p_price_option_id, p_party_size,
                                    'confirmed', 'walk_in', 'walk_in', 0, false);
  update public.bookings set checked_in_at = now(), attended_count = p_party_size where id = v_booking.id;

  if coalesce(p_cash_cents, 0) > 0 then
    insert into public.payments (booking_id, provider, kind, amount_cents, status)
    values (v_booking.id, 'cash', 'class', p_cash_cents, 'paid');
  end if;
  return v_booking.id;
end $$;

-- Create upcoming sessions from the weekly rules (idempotent).
-- p_rebuild first removes future rule-generated sessions that have no
-- bookings and were not hand-edited, so rule changes take effect.
create or replace function public.generate_sessions(p_rebuild boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Pacific/Honolulu')::date;
  v_days  integer;
  v_count integer;
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select booking_window_days into v_days from public.settings;

  if p_rebuild then
    delete from public.class_sessions s
     where s.schedule_rule_id is not null and not s.customized and s.starts_at > now()
       and not exists (select 1 from public.bookings b where b.session_id = s.id);
  end if;

  insert into public.class_sessions (
    class_type_id, schedule_rule_id, starts_at, ends_at, capacity, location_id, instructor_id
  )
  select c.class_type_id, c.rule_id, c.starts_at, c.ends_at, c.capacity, c.location_id, c.instructor_id
  from (
    select r.class_type_id,
           r.id as rule_id,
           ((v_today + g.n) + r.start_time) at time zone 'Pacific/Honolulu' as starts_at,
           ((v_today + g.n) + r.end_time)   at time zone 'Pacific/Honolulu' as ends_at,
           coalesce(r.capacity, ct.default_capacity) as capacity,
           coalesce(r.location_id, ct.location_id) as location_id,
           coalesce(r.instructor_id, ct.instructor_id) as instructor_id
    from public.schedule_rules r
    join public.class_types ct on ct.id = r.class_type_id and ct.active
    cross join generate_series(0, v_days) as g(n)
    where r.active
      and extract(dow from v_today + g.n) = r.weekday
      and v_today + g.n >= r.valid_from
      and (r.valid_until is null or v_today + g.n <= r.valid_until)
  ) c
  where c.starts_at > now()
  on conflict (class_type_id, starts_at) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The only public read: upcoming sessions with spots left, plus public
-- settings. No customer data is ever included.
create or replace function public.get_public_schedule(p_days integer default 14)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (
      select jsonb_build_object(
        'cancellation_hours', s.cancellation_hours,
        'cancellation_policy', s.cancellation_policy,
        'max_party_size', s.max_party_size,
        'online_payments_enabled', s.online_payments_enabled)
      from public.settings s),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.starts_at)
      from (
        select cs.id, cs.starts_at, cs.ends_at, cs.note, cs.capacity,
               greatest(cs.capacity - coalesce(t.taken, 0), 0) as spots_left,
               ct.slug, ct.name as class_name, ct.description, ct.detail_url,
               i.name as instructor,
               l.name as location_name, l.address as location_address, l.maps_url,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'label', p.label, 'kind', p.kind,
                          'amount_cents', p.amount_cents, 'note', p.eligibility_note)
                        order by p.sort_order, p.amount_cents)
                 from public.price_options p
                 where p.class_type_id = ct.id and p.active
                   and (p.kind <> 'online' or (select online_payments_enabled from public.settings))
               ), '[]'::jsonb) as price_options
        from public.class_sessions cs
        join public.class_types ct on ct.id = cs.class_type_id and ct.active
        left join public.instructors i on i.id = cs.instructor_id
        left join public.locations l on l.id = cs.location_id
        left join lateral (
          select sum(b.party_size) as taken from public.bookings b
          where b.session_id = cs.id
            and (b.status = 'confirmed' or (b.status = 'pending' and b.hold_expires_at > now()))
        ) t on true
        where cs.status = 'scheduled'
          and cs.starts_at > now()
          and cs.starts_at < now() + make_interval(days => least(greatest(p_days, 1), 60))
      ) x), '[]'::jsonb)
  );
$$;

-- ---- Function privileges (Postgres grants EXECUTE to PUBLIC by default) ----
revoke execute on function public.upsert_customer(text, text, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.reserve_spots(uuid, uuid, uuid, integer, text, text, text, integer, boolean) from public, anon, authenticated;
grant  execute on function public.upsert_customer(text, text, text, text, text[]) to service_role;
grant  execute on function public.reserve_spots(uuid, uuid, uuid, integer, text, text, text, integer, boolean) to service_role;

revoke execute on function public.admin_add_walkin(uuid, text, text, text, integer, uuid, integer) from public, anon;
revoke execute on function public.generate_sessions(boolean) from public, anon;
grant  execute on function public.admin_add_walkin(uuid, text, text, text, integer, uuid, integer) to authenticated;
grant  execute on function public.generate_sessions(boolean) to authenticated, service_role;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant  execute on function public.get_public_schedule(integer) to anon, authenticated;
