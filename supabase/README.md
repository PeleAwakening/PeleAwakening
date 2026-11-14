# Booking & payments backend

The website stays a static site on GitHub Pages. Everything that needs secrets
or private data runs in **Supabase** (Postgres + Auth + Edge Functions), and
payments go through **Stripe Checkout** (hosted by Stripe).

```
Browser (GitHub Pages)              Supabase                          Stripe
───────────────────────             ─────────────────────────         ──────────────
/schedule  ── get_public_schedule ─▶ Postgres function (no PII)
           ── create-booking ──────▶ Edge Function ── reserve_spots ─▶ (locks session row)
                                       └─ paid option ──────────────▶ Checkout Session
           ◀──────── redirect to Stripe-hosted payment page ─────────
                                     stripe-webhook ◀── signed event ── payment completed
                                       └─ marks booking confirmed, emails customer
/booking/manage ── manage-booking ─▶ Edge Function (signed link = access to one booking)
/admin     ── supabase-js + login ─▶ Postgres with RLS (admins only)
           ── admin-refund ────────▶ Edge Function (checks admin) ──▶ Refund
/contact   ── FormSubmit (unchanged) + submit-inquiry (copy to DB)
```

## Security model

| Concern | How it is handled |
|---|---|
| Secret keys | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the service-role key and `MANAGE_LINK_SECRET` exist only as Supabase function secrets. The repo contains only the public Supabase URL and anon key (`/js/pa-config.js`), which are designed to be public. CI (`.github/workflows/secret-scan.yml`) fails if a secret key is ever committed. |
| Customer data | Row Level Security is enabled on every table. Anonymous visitors have no table access at all; the public schedule comes from `get_public_schedule()`, which returns only class times, locations, prices and spots left. |
| Admin access | `/admin` signs in with a Supabase Auth email link. Sign-ups are disabled; only users listed in `public.admins` can read or change data (enforced by RLS in the database, not by the page). |
| Payments | Card details are entered on Stripe's own page; we store only Stripe ids and amounts. A paid booking is confirmed **only** by `stripe-webhook` after verifying Stripe's signature; the success redirect only displays status. Webhook events are de-duplicated in `stripe_events`. |
| Live payments | Online payment options stay hidden until `settings.online_payments_enabled` is set (SQL only). Separately, the functions refuse any `sk_live_` key unless `ALLOW_LIVE_PAYMENTS=true`. |
| Overbooking / double booking | `reserve_spots()` locks the session row, counts confirmed + unexpired pending spots, and rejects bookings over capacity. A partial unique index allows one active booking per customer per session. Abandoned checkouts release their hold after ~35 minutes (or immediately when the customer cancels checkout). |
| Duplicate customers | `customers.email_normalized` (lower-cased, trimmed) is unique. Public bookings never overwrite an existing customer's name or phone; they only fill blanks. |
| Booking links | "Manage booking" links are HMAC-signed (`MANAGE_LINK_SECRET`) and grant access to that single booking. Pages carrying them have analytics removed and `no-referrer`, so the link doesn't leak to third parties. |
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
| `STRIPE_SECRET_KEY` | `sk_test_…` (test mode) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe webhook endpoint |
| `MANAGE_LINK_SECRET` | random, ≥ 32 chars (`openssl rand -base64 48`) |
| `SITE_URL` | `https://peleawakening.com` |
| `ALLOWED_ORIGINS` | `https://peleawakening.com` (add `http://localhost:8000` for local testing) |
| `RESEND_API_KEY` | optional |
| `EMAIL_FROM` | `Pele Awakening <aloha@peleawakening.com>` |
| `ADMIN_NOTIFY_EMAIL` | `aloha@peleawakening.com` |
| `ALLOW_LIVE_PAYMENTS` | leave **unset** until live payments are approved |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

## Setup (test project)

```sh
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push                          # schema, seed classes, scheduled jobs
supabase secrets set --env-file ./supabase/.env   # file is git-ignored
supabase functions deploy create-booking manage-booking stripe-webhook admin-refund submit-inquiry
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
- [ ] Admin: refund from Payments tab; walk-in registration; check-in; capacity and price edits show on `/schedule`; CSV export.
- [ ] Signed-in non-admin sees no data; anonymous `curl` to `/rest/v1/customers` returns nothing.
- [ ] Contact form still emails aloha@ via FormSubmit, and a copy appears under Admin → Inquiries.

## Go-live (requires owner approval)

1. Approve prices in Admin → Classes & Prices.
2. Activate the Stripe account, create a **live** webhook endpoint, set live `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and `ALLOW_LIVE_PAYMENTS=true`.
3. `update public.settings set online_payments_enabled = true;`
4. Remove FormSubmit only after the Supabase inquiry path has been verified in production.
