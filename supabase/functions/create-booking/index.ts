// POST /functions/v1/create-booking
// Public. Validates the request, finds-or-creates the customer, reserves spots
// atomically, then either confirms (free / pay at class) or opens Stripe Checkout.
import { isEmail, isUuid, json, preflight, readJson, str } from "../_shared/http.ts";
import { serviceClient, siteUrl, stripeClient } from "../_shared/clients.ts";
import { manageUrl, sendConfirmationFor } from "../_shared/bookings.ts";
import { makeManageToken } from "../_shared/manage-token.ts";
import { formatClassTime } from "../_shared/email.ts";

const RESERVE_ERRORS: Record<string, [number, string]> = {
  session_not_found: [404, "This class could not be found."],
  session_unavailable: [409, "This class is no longer available."],
  session_started: [409, "This class has already started."],
  invalid_price_option: [400, "Please choose a valid booking option."],
  already_booked: [409, "You already have a booking for this class."],
  not_enough_spots: [409, "Not enough spots left in this class."],
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request." }, 400);
  if (str(body.website, 200)) return json(req, { error: "Invalid request." }, 400); // honeypot

  const name = str(body.name, 120);
  const email = str(body.email, 254);
  const phone = str(body.phone, 40);
  const contact = ["email", "text", "phone"].includes(body.preferred_contact as string)
    ? (body.preferred_contact as string)
    : "email";
  const partySize = Number(body.party_size);

  if (!isUuid(body.session_id) || !isUuid(body.price_option_id)) return json(req, { error: "Please choose a class and option." }, 400);
  if (!name) return json(req, { error: "Please enter your name." }, 400);
  if (!isEmail(email)) return json(req, { error: "Please enter a valid email." }, 400);
  if (!Number.isInteger(partySize) || partySize < 1) return json(req, { error: "Please choose the number of participants." }, 400);

  const db = serviceClient();

  const { data: settings, error: settingsErr } = await db.from("settings").select("*").single();
  if (settingsErr) return json(req, { error: "Booking is temporarily unavailable." }, 503);
  if (partySize > settings.max_party_size) {
    return json(req, { error: `Online bookings are limited to ${settings.max_party_size} people. Please contact us for groups.` }, 400);
  }

  const { data: option } = await db
    .from("price_options")
    .select("id, kind, label, amount_cents, active")
    .eq("id", body.price_option_id)
    .maybeSingle();
  if (!option?.active) return json(req, { error: "Please choose a valid booking option." }, 400);

  const online = option.kind === "online";
  if (online && !settings.online_payments_enabled) {
    return json(req, { error: "Online payment is not available yet. Please choose Pay at class." }, 409);
  }
  if (online && option.amount_cents * partySize < 50) {
    return json(req, { error: "Please choose a valid booking option." }, 400);
  }

  const { data: session } = await db
    .from("class_sessions")
    .select("id, starts_at, ends_at, class_types ( name, slug )")
    .eq("id", body.session_id)
    .maybeSingle();
  if (!session) return json(req, { error: RESERVE_ERRORS.session_not_found[1] }, 404);

  const { data: customerId, error: custErr } = await db.rpc("upsert_customer", {
    p_email: email,
    p_name: name,
    p_phone: phone,
    p_contact: contact,
    // deno-lint-ignore no-explicit-any
    p_interests: [(session as any).class_types.slug],
  });
  if (custErr) {
    console.error("upsert_customer", custErr);
    return json(req, { error: "Could not save your details. Please try again." }, 500);
  }

  const { data: booking, error: reserveErr } = await db.rpc("reserve_spots", {
    p_session_id: session.id,
    p_customer_id: customerId,
    p_price_option_id: option.id,
    p_party_size: partySize,
    p_status: online ? "pending" : "confirmed",
    p_payment_mode: option.kind,
    p_source: "web",
    p_hold_minutes: settings.booking_hold_minutes,
    p_enforce_cutoff: true,
  });
  if (reserveErr) {
    const known = RESERVE_ERRORS[reserveErr.message];
    if (!known) console.error("reserve_spots", reserveErr);
    const [status, message] = known ?? [500, "Could not complete your booking. Please try again."];
    return json(req, { error: message, spots_left: reserveErr.details ? Number(reserveErr.details) : undefined }, status);
  }

  if (!online) {
    await sendConfirmationFor(db, booking.id);
    return json(req, { status: "confirmed", reference: booking.reference, manage_url: await manageUrl(booking.id) });
  }

  // Paid booking: spots are held as "pending" until the Stripe webhook confirms payment.
  try {
    const stripe = stripeClient();
    const token = await makeManageToken(booking.id);
    // deno-lint-ignore no-explicit-any
    const className = (session as any).class_types.name;
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: email,
        client_reference_id: booking.reference, // shown in the Stripe Dashboard
        line_items: [{
          quantity: partySize,
          price_data: {
            currency: "usd",
            unit_amount: option.amount_cents,
            product_data: {
              name: className,
              description: `${formatClassTime(session.starts_at, session.ends_at)} · ${option.label} · Ref ${booking.reference}`,
            },
          },
        }],
        metadata: { booking_id: booking.id, booking_reference: booking.reference },
        payment_intent_data: {
          description: `${className} · ${booking.reference}`,
          metadata: { booking_id: booking.id, booking_reference: booking.reference },
        },
        // Stripe minimum is 30 minutes; the DB hold lasts slightly longer.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60 + 30,
        success_url: `${siteUrl()}/booking/success/?t=${encodeURIComponent(token)}`,
        cancel_url: `${siteUrl()}/booking/cancelled/?t=${encodeURIComponent(token)}`,
      },
      { idempotencyKey: `checkout-${booking.id}` },
    );

    const { error: payErr } = await db.from("payments").insert({
      booking_id: booking.id,
      provider: "stripe",
      kind: "class",
      amount_cents: checkout.amount_total ?? option.amount_cents * partySize,
      status: "pending",
      stripe_checkout_session_id: checkout.id,
    });
    if (payErr) throw payErr;

    return json(req, { status: "pending_payment", checkout_url: checkout.url });
  } catch (err) {
    console.error("checkout", err);
    await db.from("bookings").update({ status: "expired" }).eq("id", booking.id);
    return json(req, { error: "Online payment is temporarily unavailable. Please choose Pay at class." }, 502);
  }
});
