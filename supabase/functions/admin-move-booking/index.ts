// POST /functions/v1/admin-move-booking  { booking_id, session_id }
// Admin only. Moves a confirmed booking to another session (e.g. after a
// rain cancellation) without charging again, then emails the new details.
import { isUuid, json, preflight, readJson } from "../_shared/http.ts";
import { serviceClient } from "../_shared/clients.ts";
import { requireAdmin } from "../_shared/admin.ts";
import { sendConfirmationFor } from "../_shared/bookings.ts";

const MOVE_ERRORS: Record<string, [number, string]> = {
  booking_not_found: [404, "Booking not found."],
  booking_not_confirmed: [409, "Only confirmed bookings can be moved."],
  same_session: [400, "Choose a different class."],
  session_not_found: [404, "That class could not be found."],
  session_unavailable: [409, "That class is cancelled."],
  session_started: [409, "That class has already started."],
  already_booked: [409, "This customer is already booked in that class."],
  not_enough_spots: [409, "Not enough spots left in that class."],
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = serviceClient();
  if (!(await requireAdmin(req, db))) return json(req, { error: "Not authorized." }, 403);

  const body = await readJson(req);
  if (!body || !isUuid(body.booking_id) || !isUuid(body.session_id)) return json(req, { error: "Invalid request." }, 400);

  const { error } = await db.rpc("admin_move_booking", {
    p_booking_id: body.booking_id,
    p_new_session_id: body.session_id,
  });
  if (error) {
    const known = MOVE_ERRORS[error.message];
    if (!known) console.error("admin_move_booking", error);
    const [status, message] = known ?? [500, "Could not move the booking."];
    return json(req, { error: message }, status);
  }

  await sendConfirmationFor(db, body.booking_id as string, { moved: true });
  return json(req, { ok: true });
});
