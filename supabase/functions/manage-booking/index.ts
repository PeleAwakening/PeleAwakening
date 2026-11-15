// POST /functions/v1/manage-booking  { token, action: "view" | "cancel" | "release" }
// The signed token from the confirmation email / Stripe return URL is the
// customer's only credential, and it only grants access to that one booking.
import { json, preflight, readJson } from "../_shared/http.ts";
import { serviceClient, stripeClient } from "../_shared/clients.ts";
import { loadBooking } from "../_shared/bookings.ts";
import { escapeHtml, formatClassTime, sendEmail } from "../_shared/email.ts";
import { verifyManageToken } from "../_shared/manage-token.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const body = await readJson(req);
  const bookingId = await verifyManageToken(body?.token);
  if (!bookingId) return json(req, { error: "This link is not valid." }, 404);

  const db = serviceClient();
  const b = await loadBooking(db, bookingId);
  if (!b) return json(req, { error: "Booking not found." }, 404);

  const { data: settings } = await db.from("settings").select("cancellation_hours, cancellation_policy").single();
  const startsAt = new Date(b.class_sessions.starts_at).getTime();
  const cutoff = startsAt - settings!.cancellation_hours * 3600 * 1000;
  const canCancel = ["pending", "confirmed"].includes(b.status) && Date.now() <= cutoff;
  const stripePayment = (b.payments ?? []).find((p: { provider: string }) => p.provider === "stripe");

  const summary = () => ({
    reference: b.reference,
    status: b.status,
    class_name: b.class_sessions.class_types.name,
    starts_at: b.class_sessions.starts_at,
    ends_at: b.class_sessions.ends_at,
    session_cancelled: b.class_sessions.status === "cancelled",
    location_name: b.class_sessions.locations?.name ?? null,
    location_address: b.class_sessions.locations?.address ?? null,
    maps_url: b.class_sessions.locations?.maps_url ?? null,
    party_size: b.party_size,
    option_label: b.price_options?.label ?? null,
    total_amount_cents: b.total_amount_cents,
    payment_mode: b.payment_mode,
    payment_status: stripePayment?.status ?? null,
    refund_requested: Boolean(stripePayment?.refund_requested_at),
    can_cancel: canCancel,
    cancellation_policy: settings!.cancellation_policy,
  });

  const action = body?.action;

  if (action === "view") return json(req, summary());

  if (action === "release") {
    // Customer left Stripe Checkout: free the held spots right away.
    if (b.status === "pending") {
      await db.from("bookings").update({ status: "expired" }).eq("id", bookingId).eq("status", "pending");
      if (stripePayment?.stripe_checkout_session_id && stripePayment.status === "pending") {
        try {
          await stripeClient().checkout.sessions.expire(stripePayment.stripe_checkout_session_id);
        } catch (err) {
          console.warn("checkout expire", err); // already completed or expired
        }
      }
      b.status = "expired";
    }
    return json(req, summary());
  }

  if (action === "cancel") {
    if (!canCancel) {
      return json(req, { error: `Bookings can be cancelled online up to ${settings!.cancellation_hours} hours before class. Please contact us.` }, 409);
    }
    const { data: updated } = await db
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", bookingId)
      .in("status", ["pending", "confirmed"])
      .select("id");
    if (!updated?.length) return json(req, { error: "This booking can no longer be cancelled." }, 409);
    b.status = "cancelled";

    const paid = stripePayment?.status === "paid";
    if (paid) {
      // Refunds are issued by an admin from the dashboard.
      await db.from("payments").update({ refund_requested_at: new Date().toISOString() }).eq("id", stripePayment.id);
      stripePayment.refund_requested_at = new Date().toISOString();
    }

    const admin = Deno.env.get("ADMIN_NOTIFY_EMAIL");
    if (admin) {
      await sendEmail(
        admin,
        `Booking cancelled${paid ? " (refund requested)" : ""}: ${b.class_sessions.class_types.name}`,
        `<p>${escapeHtml(b.customers?.name)} cancelled ${b.party_size} spot(s) for
         ${escapeHtml(b.class_sessions.class_types.name)}, ${escapeHtml(formatClassTime(b.class_sessions.starts_at))}.</p>
         ${paid ? "<p>A refund was requested. Issue it from the admin dashboard → Payments.</p>" : ""}`,
      );
    }
    return json(req, summary());
  }

  return json(req, { error: "Unknown action." }, 400);
});
