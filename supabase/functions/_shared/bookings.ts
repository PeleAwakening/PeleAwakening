import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { siteUrl } from "./clients.ts";
import { type BookingEmailData, sendBookingConfirmation } from "./email.ts";
import { makeManageToken } from "./manage-token.ts";

// deno-lint-ignore no-explicit-any
export type BookingDetails = any;

export async function loadBooking(db: SupabaseClient, bookingId: string): Promise<BookingDetails | null> {
  const { data, error } = await db
    .from("bookings")
    .select(`id, reference, status, party_size, total_amount_cents, payment_mode, cancelled_at,
      customers ( name, email, phone ),
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

export function toEmailData(b: BookingDetails): BookingEmailData {
  const s = b.class_sessions;
  return {
    reference: b.reference,
    customerName: b.customers?.name ?? "",
    customerEmail: b.customers?.email ?? null,
    customerPhone: b.customers?.phone ?? null,
    className: s.class_types.name,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    locationName: s.locations?.name ?? null,
    locationAddress: s.locations?.address ?? null,
    mapsUrl: s.locations?.maps_url ?? null,
    partySize: b.party_size,
    optionLabel: b.price_options?.label ?? null,
    totalCents: b.total_amount_cents,
    paymentMode: b.payment_mode,
  };
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
      ...toEmailData(b),
      manageUrl: await manageUrl(bookingId),
      cancellationPolicy: settings?.cancellation_policy ?? "",
      moved: opts.moved,
    });
  } catch (err) {
    console.error("confirmation email failed", bookingId, err);
  }
}
