import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { siteUrl } from "./clients.ts";
import { sendBookingConfirmation } from "./email.ts";
import { makeManageToken } from "./manage-token.ts";

// deno-lint-ignore no-explicit-any
export type BookingDetails = any;

export async function loadBooking(db: SupabaseClient, bookingId: string): Promise<BookingDetails | null> {
  const { data, error } = await db
    .from("bookings")
    .select(`id, reference, status, party_size, total_amount_cents, payment_mode, cancelled_at,
      customers ( name, email ),
      price_options ( label ),
      payments ( id, provider, status, amount_cents, refund_requested_at, stripe_checkout_session_id ),
      class_sessions ( starts_at, ends_at, status,
        class_types ( name ),
        locations ( name, address, maps_url ) )`)
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function manageUrl(bookingId: string): Promise<string> {
  return `${siteUrl()}/booking/manage/?t=${encodeURIComponent(await makeManageToken(bookingId))}`;
}

// Email failures are logged and never fail the booking itself.
export async function sendConfirmationFor(
  db: SupabaseClient,
  bookingId: string,
  opts: { moved?: boolean } = {},
): Promise<void> {
  try {
    const b = await loadBooking(db, bookingId);
    if (!b) return;
    const { data: settings } = await db.from("settings").select("cancellation_policy").single();
    await sendBookingConfirmation({
      reference: b.reference,
      customerName: b.customers?.name ?? "",
      customerEmail: b.customers?.email ?? null,
      className: b.class_sessions.class_types.name,
      startsAt: b.class_sessions.starts_at,
      endsAt: b.class_sessions.ends_at,
      locationName: b.class_sessions.locations?.name ?? null,
      mapsUrl: b.class_sessions.locations?.maps_url ?? null,
      partySize: b.party_size,
      optionLabel: b.price_options?.label ?? null,
      totalCents: b.total_amount_cents,
      paymentMode: b.payment_mode,
      manageUrl: await manageUrl(bookingId),
      cancellationPolicy: settings?.cancellation_policy ?? "",
      moved: opts.moved,
    });
  } catch (err) {
    console.error("confirmation email failed", bookingId, err);
  }
}
