// Transactional email via Resend. If RESEND_API_KEY is not set, emails are
// skipped (logged) so bookings still work during testing.
export const HAWAII_TZ = "Pacific/Honolulu";

export function formatClassTime(startsAt: string, endsAt?: string): string {
  const start = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: HAWAII_TZ, weekday: "long", month: "long", day: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: HAWAII_TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day}, ${time(start)}${endsAt ? `–${time(new Date(endsAt))}` : ""} (Hawaii time)`;
}

export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[email skipped: RESEND_API_KEY not set] to=${to} subject=${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") ?? "Pele Awakening <aloha@peleawakening.com>",
      reply_to: Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "aloha@peleawakening.com",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text());
}

export interface BookingEmailData {
  customerName: string;
  customerEmail: string | null;
  className: string;
  startsAt: string;
  endsAt: string;
  locationName: string | null;
  mapsUrl: string | null;
  partySize: number;
  optionLabel: string | null;
  totalCents: number;
  paymentMode: string;
  manageUrl: string;
  cancellationPolicy: string;
  moved?: boolean;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

export async function sendBookingConfirmation(b: BookingEmailData): Promise<void> {
  const when = formatClassTime(b.startsAt, b.endsAt);
  const payment = b.paymentMode === "online"
    ? `Paid online: ${money(b.totalCents)}`
    : b.paymentMode === "in_person"
    ? `Pay at class: ${money(b.totalCents)}`
    : escapeHtml(b.optionLabel ?? "Free");

  if (b.customerEmail) {
    await sendEmail(
      b.customerEmail,
      b.moved ? `Your class has been moved: ${b.className}` : `You're booked: ${b.className}`,
      `<p>Aloha ${escapeHtml(b.customerName)},</p>
       <p>${b.moved
        ? "Your booking has been moved to the class below. There is nothing more to pay."
        : "Your spot is confirmed."}</p>
       <p><strong>${escapeHtml(b.className)}</strong><br>
          ${escapeHtml(when)}<br>
          ${escapeHtml(b.locationName ?? "")}${b.mapsUrl ? ` · <a href="${escapeHtml(b.mapsUrl)}">Google Maps</a>` : ""}<br>
          Participants: ${b.partySize}<br>
          ${payment}</p>
       <p><a href="${escapeHtml(b.manageUrl)}">View or cancel your booking</a></p>
       <p style="color:#6f6252;font-size:13px">${escapeHtml(b.cancellationPolicy)}</p>
       <p>Mahalo,<br>Pele Awakening</p>`,
    );
  }

  const admin = Deno.env.get("ADMIN_NOTIFY_EMAIL");
  if (admin && !b.moved) {
    await sendEmail(
      admin,
      `New booking: ${b.className}, ${when}`,
      `<p>${escapeHtml(b.customerName)} booked ${b.partySize} spot(s).</p>
       <p>${escapeHtml(b.className)}<br>${escapeHtml(when)}<br>${payment}</p>`,
    );
  }
}
