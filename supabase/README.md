# Booking & payments backend

The website stays a static site on GitHub Pages. Everything that needs secrets
or private data runs in **Supabase** (Postgres + Auth + Edge Functions), and
payments go through **Stripe Checkout** (hosted by Stripe).

```
Browser (GitHub Pages)              Supabase                          Stripe
───────────────────────             ─────────────────────────         ──────────────
/reservation  (static "Book Now" landing → /schedule, Contact, Experiences interest form)
/schedule  ── get_public_schedule ─▶ Postgres function (no PII)
           ── create-booking ──────▶ Edge Function ── reserve_spots ─▶ (locks session row)
                                       └─ paid option ──────────────▶ Checkout Session
           ◀──────── redirect to Stripe-hosted payment page ─────────
                                     stripe-webhook ◀── signed event ── payment completed
                                       └─ marks booking confirmed, emails customer
/booking/manage ── manage-booking ─▶ Edge Function (signed link = access to one booking)
/admin     ── supabase-js + login ─▶ Postgres with RLS (admins only)
           ── admin-refund ────────▶ Edge Function (checks admin) ──▶ Refund
           ── admin-move-booking ──▶ Edge Function (checks admin): weather moves
```

## Security model

| Concern | How it is handled |
|---|---|
| Secret keys | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the service-role key and `MANAGE_LINK_SECRET` exist only as Supabase function secrets. The repo contains only the public Supabase URL and anon key (`/js/pa-config.js`), which are designed to be public. CI (`.github/workflows/secret-scan.yml`) fails if a secret key is ever committed. |
| Customer data | Row Level Security is enabled on every table. Anonymous visitors have no table access at all; the public schedule comes from `get_public_schedule()`, which returns only class times, locations, prices and spots left. |
| Admin access | `/admin` signs in with a Supabase Auth email link. Sign-ups are disabled; only users listed in `public.admins` can read or change data (enforced by RLS in the database, not by the page). |
| Payments | Card details are entered on Stripe's own page; we store only Stripe ids and amounts. A paid booking is confirmed **only** by `stripe-webhook` after verifying Stripe's signature; the success redirect only displays status. Webhook events are de-duplicated in `stripe_events`. |
| Live payments | Online payment options stay hidden until `settings.online_payments_enabled` is set (SQL only). Separately, the functions refuse any `sk_live_`/`rk_live_` key unless `ALLOW_LIVE_PAYMENTS=true`. |
| Overbooking / double booking | `reserve_spots()` locks the session row, counts confirmed + unexpired pending spots, and rejects bookings over capacity. A partial unique index allows one active booking per customer per session. Abandoned checkouts release their hold after ~35 minutes (or immediately when the customer cancels checkout). |
| Duplicate customers | `customers.email_normalized` (lower-cased, trimmed) is unique. Public bookings never overwrite an existing customer's name or phone; they only fill blanks. |
| Booking links | "Manage booking" links are HMAC-signed (`MANAGE_LINK_SECRET`) and grant access to that single booking. Pages carrying them have analytics removed and `no-referrer`, so the link doesn't leak to third parties. |
| Booking references | Each booking gets a short reference like `PA-20261215-T74N` (Hawaii booking date + 4 random characters, no 0/O/1/I), unique in the database. It appears in confirmation emails, the manage page, the admin dashboard (with a search box) and Stripe (`client_reference_id`, metadata, payment description). The uuid `id` is still used for every technical operation, including the webhook. |
| Hawaii time | Times are stored as `timestamptz`; weekly rules are interpreted in `Pacific/Honolulu` and everything is displayed in Hawaii time. |

**The GitHub repository can stay public.** Nothing in it grants access to data
or money. (Note: GitHub Pages from a *private* repo requires a paid GitHub plan.)

## Accounts needed

1. **Supabase**: create a project (region: US West). The free tier works for testing; Pro ($25/mo) is recommended at launch for daily backups.
2. **Stripe**: use **test mode** only until pricing and configuration are approved.
3. **Resend** (optional, free tier): booking confirmation emails. Verify the `peleawakening.com` domain (DNS records). Without it, bookings work but no emails are sent.

## Secrets (Supabase → Edge Functions → Secrets)

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | A **restricted key** `rk_test_…` (see *Stripe* below). A full `sk_test_…` also works but isn't recommended. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe webhook endpoint |
| `MANAGE_LINK_SECRET` | random, ≥ 32 chars (`openssl rand -base64 48`) |
| `SITE_URL` | `https://peleawakening.com` |
| `ALLOWED_ORIGINS` | `https://peleawakening.com` (add `http://localhost:8000` for local testing) |
| `RESEND_API_KEY` | optional |
| `EMAIL_FROM` | `Pele Awakening <aloha@peleawakening.com>` |
| `ADMIN_NOTIFY_EMAIL` | `aloha@peleawakening.com` |
| `ALLOW_LIVE_PAYMENTS` | leave **unset** until live payments are approved |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

## Stripe

- **Integration:** Stripe-hosted Checkout Sessions (`stripe-node` 23.1.0, API version `2026-10-28.endive`), created server-side with the amount from the database. No `payment_method_types` is passed, so payment methods are managed in the Dashboard (Settings → Payment methods). The website never loads Stripe.js, so the **publishable key isn't used** anywhere.
- **Environment:** use a Stripe **sandbox** (Dashboard → account menu → *Sandboxes*) or test mode. Never live until go-live is approved.
- **Restricted key:** Dashboard → Developers → API keys → *Create restricted key*, named `pele-awakening-supabase`, with only:
  - Checkout Sessions: **Write**
  - Refunds: **Write**
  If a function logs a Stripe `403`, add the one permission it names. Paste the key only into Supabase secrets (`STRIPE_SECRET_KEY`), never into the repo or a chat.
- **Webhook:** required. It is the only thing that confirms a paid booking (see *Setup* step 3). Signatures are verified and events de-duplicated.
- **Testing locally:** `stripe login`, then `stripe trigger checkout.session.completed` sends test events, and test card `4242 4242 4242 4242` completes Checkout.
- **Hawaii GET:** Stripe Tax is **not** enabled (`automatic_tax` is off). Hawaii's General Excise Tax applies to services; decide with your accountant whether class prices include GET before go-live. Turning on Stripe Tax requires an active Hawaii registration in Stripe first.

## Setup (test project)

```sh
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push                          # schema, seed classes, scheduled jobs
supabase secrets set --env-file ./supabase/.env   # file is git-ignored
supabase functions deploy create-booking manage-booking stripe-webhook admin-refund admin-move-booking submit-inquiry
```

Then:

1. **Auth → URL configuration**: Site URL `https://peleawakening.com`, redirect URL `https://peleawakening.com/admin/`. **Auth → Providers → Email**: disable "Allow new users to sign up".
2. **Create your admin**: Auth → Users → *Invite user* (your email). Then in the SQL editor:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'aloha@peleawakening.com';
   ```
3. **Stripe webhook** (test mode): endpoint `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `charge.refunded`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Put the project URL and anon key in `/js/pa-config.js`.
5. To test online payment (test mode only):
   ```sql
   update public.settings set online_payments_enabled = true;
   ```

## Test checklist (before merging to `main`)

- [ ] `/schedule` lists the next 14 days in Hawaii time; filters work; full classes show "Full".
- [ ] "Pay at class" booking → confirmed, email received, spots decrease.
- [ ] "Free (Age 60+)" appears only on Wednesday/Friday morning Yang classes; booking skips Stripe.
- [ ] Booking the same class twice with the same email (any capitalization) is refused; only one customer row exists.
- [ ] Booking more people than spots left is refused; two people booking the last spot at once → only one succeeds.
- [ ] Stripe test card `4242 4242 4242 4242` → redirected back, booking confirmed **by the webhook** (check `stripe_events`).
- [ ] Leaving Stripe Checkout → spots released immediately.
- [ ] Manage link: cancel ≥ 24h before → cancelled (paid → refund requested); < 24h → refused.
- [ ] Admin: refund from Payments tab (a full refund cancels the booking and frees its spots; partial refunds keep it); walk-in registration; check-in; capacity and price edits show on `/schedule`; CSV export.
- [ ] Signed-in non-admin sees no data; anonymous `curl` to `/rest/v1/customers` returns nothing.
- [ ] Every booking shows a `PA-…` reference in the email, on the manage page, in Admin → Bookings (search finds it) and Payments, and on the Stripe payment.
- [ ] Weather: Admin → Bookings → *Cancel class (weather)* hides the session from `/schedule`; *Move* puts a paid customer in another class with no new charge and emails them.

## MVP scope

- $10 per morning Tai Chi class and $30 per evening class: **Book & Pay Online** (Stripe) or **Reserve Now, Pay at Class**; **Free (Age 60+)** on Wednesday and Friday mornings.
- Weather cancellations are handled by an admin: cancel the session, then *Move* each booking (the payment carries over) or refund it.
- `/reservation/` is the single "Book Now" entry point: Tai Chi → `/schedule/`; Therapy & Bodywork → Contact form; Signature Experiences → the existing interest form. No therapy booking yet.
- Memberships/passes tables exist but are not exposed anywhere. `submit-inquiry` is deployed but the Contact page is unchanged and does not call it yet.

## Go-live (requires owner approval)

0. Testing used `SITE_URL=http://localhost:8000`, then the Wi-Fi preview `http://192.168.4.50:8000` (phone testing), so Stripe and email links return to the local preview. Set it back: `supabase secrets set SITE_URL=https://peleawakening.com ALLOWED_ORIGINS=https://peleawakening.com`. Delete test bookings and customers.
1. Approve prices in Admin → Classes & Prices.
2. Activate the Stripe account, create a **live** webhook endpoint, set live `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and `ALLOW_LIVE_PAYMENTS=true`.
3. `update public.settings set online_payments_enabled = true;`
4. FormSubmit stays. Later: connect the Contact page to `submit-inquiry`, verify it, and only then retire FormSubmit.
