// POST /functions/v1/stripe-webhook
// The only place a paid booking becomes confirmed. Every request must carry a
// valid Stripe signature; browser redirects never confirm anything.
import Stripe from "npm:stripe@23.1.0";
import { serviceClient, stripeCrypto } from "../_shared/clients.ts";
import { sendConfirmationFor } from "../_shared/bookings.ts";

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const signature = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) return reply(400, { error: "missing_signature" });

  let event: Stripe.Event;
  try {
    // Verification needs only the signing secret, not the API key, so events
    // (e.g. refunds made in the Stripe Dashboard) sync even while
    // ALLOW_LIVE_PAYMENTS is off.
    event = await Stripe.webhooks.constructEventAsync(await req.text(), signature, secret, undefined, stripeCrypto);
  } catch (err) {
    console.error("signature verification failed", err);
    return reply(400, { error: "invalid_signature" });
  }

  const db = serviceClient();

  // Idempotency: Stripe retries; process each event id once.
  const { error: dupErr } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupErr) {
    if (dupErr.code === "23505") return reply(200, { duplicate: true });
    console.error("stripe_events insert", dupErr);
    return reply(500, { error: "db_error" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status === "paid") await markPaid(db, s);
        break;
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const s = event.data.object as Stripe.Checkout.Session;
        const failed = event.type === "checkout.session.async_payment_failed";
        const { data: payment } = await db
          .from("payments")
          .update({ status: failed ? "failed" : "expired" })
          .eq("stripe_checkout_session_id", s.id)
          .eq("status", "pending")
          .select("booking_id")
          .maybeSingle();
        const bookingId = payment?.booking_id ?? s.metadata?.booking_id;
        if (bookingId) {
          await db.from("bookings").update({ status: "expired" }).eq("id", bookingId).eq("status", "pending");
        }
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (typeof charge.payment_intent === "string") {
          const { data: payment, error: payErr } = await db
            .from("payments")
            .update({
              refunded_amount_cents: charge.amount_refunded,
              ...(charge.refunded ? { status: "refunded" } : {}),
            })
            .eq("stripe_payment_intent_id", charge.payment_intent)
            .select("booking_id")
            .maybeSingle();
          if (payErr) throw payErr;
          // A fully refunded booking gives up its spots. Partial refunds keep it.
          if (charge.refunded && payment?.booking_id) {
            const { error: bookErr } = await db
              .from("bookings")
              .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
              .eq("id", payment.booking_id)
              .in("status", ["pending", "confirmed"]);
            if (bookErr) throw bookErr;
          }
        }
        break;
      }
    }
  } catch (err) {
    // Let Stripe retry: forget the event so the retry is processed.
    console.error("webhook handling failed", event.type, event.id, err);
    await db.from("stripe_events").delete().eq("id", event.id);
    return reply(500, { error: "handler_error" });
  }

  return reply(200, { received: true });
});

// deno-lint-ignore no-explicit-any
async function markPaid(db: any, s: Stripe.Checkout.Session) {
  const paymentIntent = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;

  const { data: payment, error } = await db
    .from("payments")
    .update({ status: "paid", stripe_payment_intent_id: paymentIntent, amount_cents: s.amount_total ?? 0 })
    .eq("stripe_checkout_session_id", s.id)
    .select("booking_id")
    .maybeSingle();
  if (error) throw error;

  let bookingId: string | null = payment?.booking_id ?? null;
  if (!payment) {
    // Payment row missing (should not happen): record it from the event.
    bookingId = s.metadata?.booking_id ?? null;
    const { error: insErr } = await db.from("payments").insert({
      booking_id: bookingId,
      provider: "stripe",
      kind: "class",
      amount_cents: s.amount_total ?? 0,
      status: "paid",
      stripe_checkout_session_id: s.id,
      stripe_payment_intent_id: paymentIntent,
    });
    if (insErr) throw insErr;
  }
  if (!bookingId) return;

  // Confirm even if the hold lapsed: the customer has paid. (Holds outlast the
  // 30-minute Checkout expiry, so this is a rare edge case for the admin to see.)
  const { data: confirmed, error: bookErr } = await db
    .from("bookings")
    .update({ status: "confirmed", hold_expires_at: null })
    .eq("id", bookingId)
    .in("status", ["pending", "expired"])
    .select("id");
  if (bookErr) throw bookErr;

  if (confirmed?.length) await sendConfirmationFor(db, bookingId);
}
