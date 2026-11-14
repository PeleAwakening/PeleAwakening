// POST /functions/v1/admin-refund  { payment_id, amount_cents? }
// Requires a signed-in admin (Supabase Auth JWT + row in public.admins).
import { isUuid, json, preflight, readJson } from "../_shared/http.ts";
import { serviceClient, stripeClient } from "../_shared/clients.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = serviceClient();
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return json(req, { error: "Not signed in." }, 401);
  const { data: admin } = await db.from("admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!admin) return json(req, { error: "Not authorized." }, 403);

  const body = await readJson(req);
  if (!body || !isUuid(body.payment_id)) return json(req, { error: "Invalid request." }, 400);

  const { data: payment } = await db.from("payments").select("*").eq("id", body.payment_id).maybeSingle();
  if (!payment) return json(req, { error: "Payment not found." }, 404);
  if (payment.provider !== "stripe" || !payment.stripe_payment_intent_id) {
    return json(req, { error: "Only online (Stripe) payments can be refunded here." }, 400);
  }
  const refundable = payment.amount_cents - payment.refunded_amount_cents;
  const amount = body.amount_cents === undefined ? refundable : Number(body.amount_cents);
  if (payment.status !== "paid" || refundable <= 0) return json(req, { error: "Nothing left to refund." }, 409);
  if (!Number.isInteger(amount) || amount < 1 || amount > refundable) return json(req, { error: "Invalid refund amount." }, 400);

  try {
    await stripeClient().refunds.create(
      { payment_intent: payment.stripe_payment_intent_id, amount },
      { idempotencyKey: `refund-${payment.id}-${payment.refunded_amount_cents}-${amount}` },
    );
  } catch (err) {
    console.error("refund", err);
    return json(req, { error: (err as Error).message }, 502);
  }

  // The charge.refunded webhook records the final state; update now for the UI.
  const refunded = payment.refunded_amount_cents + amount;
  await db
    .from("payments")
    .update({ refunded_amount_cents: refunded, ...(refunded >= payment.amount_cents ? { status: "refunded" } : {}) })
    .eq("id", payment.id);

  return json(req, { ok: true, refunded_amount_cents: refunded });
});
