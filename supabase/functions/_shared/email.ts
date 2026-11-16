// Transactional email via Resend. If RESEND_API_KEY is not set, emails are
// skipped (logged) so bookings still work during testing.
//
// Two looks, on purpose: customer emails use the site's brand (logo, cream and
// terracotta, Manage Booking button); admin notices are plain, marked "[Admin]"
// and carry the customer's contact details. Inline styles and tables only, so
// they render in Gmail, Outlook and phone mail apps.
import { siteUrl } from "./clients.ts";

export const HAWAII_TZ = "Pacific/Honolulu";

const hawaii = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: HAWAII_TZ, ...opts }).format(d);

export const formatClassDate = (startsAt: string) =>
  hawaii(new Date(startsAt), { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function formatTimeRange(startsAt: string, endsAt?: string): string {
  const time = (s: string) => hawaii(new Date(s), { hour: "numeric", minute: "2-digit" });
  return `${time(startsAt)}${endsAt ? `–${time(endsAt)}` : ""} Hawaii time (HST)`;
}

export function formatClassTime(startsAt: string, endsAt?: string): string {
  const day = hawaii(new Date(startsAt), { weekday: "long", month: "long", day: "numeric" });
  const time = (s: string) => hawaii(new Date(s), { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time(startsAt)}${endsAt ? `–${time(endsAt)}` : ""} (Hawaii time)`;
}

export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[email skipped: RESEND_API_KEY not set] subject=${subject}`);
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
      ...(text ? { text } : {}),
    }),
  });
  // Log the Resend id (not the address) so a send can be traced in the Resend dashboard.
  if (res.ok) console.log(`[email sent] id=${(await res.json()).id} subject=${subject}`);
  else console.error("Resend error", res.status, await res.text());
}

export interface BookingEmailData {
  reference: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  className: string;
  startsAt: string;
  endsAt: string;
  locationName: string | null;
  locationAddress: string | null;
  mapsUrl: string | null;
  partySize: number;
  optionLabel: string | null;
  totalCents: number;
  paymentMode: string;
  manageUrl?: string;
  cancellationPolicy?: string;
  moved?: boolean;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

function paymentStatus(b: BookingEmailData): string {
  if (b.paymentMode === "online") return `Paid online · ${money(b.totalCents)}`;
  if (b.paymentMode === "in_person") return `${money(b.totalCents)} · pay at class`;
  return b.optionLabel ?? "Free";
}

// ---------------------------------------------------------------------------
// Layout

// Served by the live site (GitHub Pages), so it loads in any mail app.
const LOGO_URL = "https://peleawakening.com/images/pele-logo.png";
const C = {
  bg: "#f6f1e9", card: "#fffdfa", ink: "#2b241d", dim: "#6f6252",
  accent: "#a8622f", line: "#ede2d3", gold: "#b8934f",
};
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

type Row = [label: string, valueHtml: string];

function detailsTable(rows: Row[], color = C.line): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0">
    ${rows.map(([label, value]) => `<tr>
      <td valign="top" style="padding:10px 12px 10px 0;border-top:1px solid ${color};width:34%;font:13px/1.5 ${SANS};color:${C.dim}">${escapeHtml(label)}</td>
      <td valign="top" style="padding:10px 0;border-top:1px solid ${color};font:15px/1.5 ${SANS};color:${C.ink}">${value}</td>
    </tr>`).join("")}
  </table>`;
}

function button(href: string, label: string, bg = C.accent): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr>
    <td style="border-radius:999px;background:${bg}">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

function page(title: string, preheader: string, inner: string, bg: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
${inner}
</table></td></tr></table></body></html>`;
}

function customerLayout(o: { title: string; preheader: string; eyebrow: string; heading: string; body: string }): string {
  return page(o.title, o.preheader, `
<tr><td align="center" style="padding:8px 0 18px">
  <img src="${LOGO_URL}" width="64" height="64" alt="" style="display:block;border:0;width:64px;height:64px;border-radius:50%">
  <div style="margin-top:10px;font:600 13px/1 Cinzel, Georgia, serif;letter-spacing:.22em;color:${C.ink}">PELE AWAKENING</div>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:28px 24px">
  <div style="font:600 12px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.accent}">${escapeHtml(o.eyebrow)}</div>
  <h1 style="margin:10px 0 0;font:500 28px/1.2 ${SERIF};color:${C.ink}">${o.heading}</h1>
  ${o.body}
</td></tr>
<tr><td align="center" style="padding:20px 8px 8px;font:13px/1.6 ${SANS};color:${C.dim}">
  Questions? Just reply to this email.<br>
  Pele Awakening · Honolulu, Hawaiʻi · <a href="https://peleawakening.com" style="color:${C.dim}">peleawakening.com</a>
</td></tr>`, C.bg);
}

function adminLayout(o: { title: string; preheader: string; heading: string; body: string }): string {
  return page(o.title, o.preheader, `
<tr><td style="background:#2b241d;border-radius:8px 8px 0 0;padding:10px 20px;font:600 12px/1.4 ${SANS};letter-spacing:.08em;color:#f6f1e9">
  ADMIN NOTICE · Pele Awakening bookings · not sent to customers
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #d9d4cc;border-top:0;border-radius:0 0 8px 8px;padding:22px 20px">
  <h1 style="margin:0;font:600 20px/1.3 ${SANS};color:${C.ink}">${o.heading}</h1>
  ${o.body}
</td></tr>`, "#eeece8");
}

const unescapeHtml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e as string]!);

// Plain-text version of the details: links become "text: url".
const textBlock = (rows: Row[]) =>
  rows.map(([label, value]) => {
    const plain = value
      .replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (_, href, t) => (href.startsWith("mailto:") ? t : `${t}: ${href}`))
      .replace(/<br>/g, ", ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${label}: ${unescapeHtml(plain)}`;
  }).join("\n");

function locationHtml(b: BookingEmailData): string {
  if (!b.locationName) return "To be confirmed";
  return `${escapeHtml(b.locationName)}${b.locationAddress ? `<br><span style="color:${C.dim}">${escapeHtml(b.locationAddress)}</span>` : ""}${
    b.mapsUrl ? `<br><a href="${escapeHtml(b.mapsUrl)}" style="color:${C.accent}">Open in Google Maps</a>` : ""}`;
}

function bookingRows(b: BookingEmailData): Row[] {
  return [
    ["Booking reference", `<strong style="letter-spacing:.04em;white-space:nowrap">${escapeHtml(b.reference)}</strong>`],
    ["Name", escapeHtml(b.customerName)],
    ["Class", escapeHtml(b.className)],
    ["Date", escapeHtml(formatClassDate(b.startsAt))],
    ["Time", escapeHtml(formatTimeRange(b.startsAt, b.endsAt))],
    ["Participants", String(b.partySize)],
    ["Location", locationHtml(b)],
    ["Payment", escapeHtml(paymentStatus(b))],
  ];
}

function adminRows(b: BookingEmailData): Row[] {
  const rows = bookingRows(b).filter(([label]) => label !== "Name" && label !== "Location");
  rows.splice(1, 0,
    ["Customer", escapeHtml(b.customerName)],
    ["Email", b.customerEmail ? `<a href="mailto:${escapeHtml(b.customerEmail)}">${escapeHtml(b.customerEmail)}</a>` : "—"],
    ["Phone", escapeHtml(b.customerPhone || "—")],
  );
  rows.push(["Location", escapeHtml(b.locationName ?? "—")]);
  return rows;
}

const adminButton = () => button(`${siteUrl()}/admin/`, "Open Admin Dashboard", "#2b241d");

// ---------------------------------------------------------------------------
// Emails

export async function sendBookingConfirmation(b: BookingEmailData): Promise<void> {
  const when = `${formatClassDate(b.startsAt)}, ${formatTimeRange(b.startsAt, b.endsAt)}`;

  if (b.customerEmail) {
    const rows = bookingRows(b);
    const subject = b.moved
      ? `Your class has changed: ${b.className} (${b.reference})`
      : `You're booked: ${b.className} (${b.reference})`;
    const intro = b.moved
      ? `Your booking has been moved to the class below.${b.paymentMode === "online" ? " Your payment carries over; there is nothing more to pay." : ""}`
      : "Your spot is confirmed. We look forward to practicing with you.";
    const manage = b.manageUrl
      ? `${button(b.manageUrl, "Manage Booking")}
         <p style="margin:10px 0 0;font:13px/1.6 ${SANS};color:${C.dim}">View your booking or cancel it online. This link is private to you, so please don't forward this email.</p>`
      : "";
    const policy = b.cancellationPolicy
      ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid ${C.line};font:13px/1.6 ${SANS};color:${C.dim}">${escapeHtml(b.cancellationPolicy)}</p>`
      : "";
    const html = customerLayout({
      title: subject,
      preheader: `${b.className}, ${when}. Reference ${b.reference}.`,
      eyebrow: b.moved ? "Class changed" : "Booking confirmed",
      heading: `Aloha ${escapeHtml(b.customerName.split(" ")[0] || b.customerName)}, ${b.moved ? "your booking has moved." : "you're booked."}`,
      body: `<p style="margin:12px 0 0;font:15px/1.6 ${SANS};color:${C.ink}">${escapeHtml(intro)}</p>
        ${detailsTable(rows)}${manage}${policy}`,
    });
    const text = [
      `Aloha ${b.customerName},`, "", intro, "", textBlock(rows), "",
      ...(b.manageUrl ? [`Manage your booking (private link): ${b.manageUrl}`, ""] : []),
      ...(b.cancellationPolicy ? [b.cancellationPolicy, ""] : []),
      "Questions? Just reply to this email.", "Mahalo,", "Pele Awakening · peleawakening.com",
    ].join("\n");
    await sendEmail(b.customerEmail, subject, html, text);
  }

  const admin = Deno.env.get("ADMIN_NOTIFY_EMAIL");
  if (admin && !b.moved) {
    const rows = adminRows(b);
    const subject = `[Admin] New booking ${b.reference}: ${b.className}, ${formatClassTime(b.startsAt)}`;
    await sendEmail(admin, subject, adminLayout({
      title: subject,
      preheader: `${b.customerName} booked ${b.partySize} spot(s).`,
      heading: `New booking · <span style="white-space:nowrap">${escapeHtml(b.reference)}</span>`,
      body: `${detailsTable(rows, "#e6e2db")}${adminButton()}`,
    }), `New booking\n\n${textBlock(rows)}\n\nAdmin dashboard: ${siteUrl()}/admin/`);
  }
}

export async function sendCancellationNotice(b: BookingEmailData, opts: { refundRequested: boolean }): Promise<void> {
  const admin = Deno.env.get("ADMIN_NOTIFY_EMAIL");
  if (!admin) return;
  const rows = adminRows(b);
  const subject = `[Admin] Booking cancelled ${b.reference}${opts.refundRequested ? " (refund requested)" : ""}: ${b.className}, ${formatClassTime(b.startsAt)}`;
  const refund = opts.refundRequested
    ? `<p style="margin:14px 0 0;padding:12px 14px;background:#fbefe3;border-left:3px solid ${C.accent};font:14px/1.5 ${SANS};color:${C.ink}">
        <strong>Refund requested.</strong> This booking was paid online. Issue the refund in Admin → Payments.</p>`
    : "";
  await sendEmail(admin, subject, adminLayout({
    title: subject,
    preheader: `${b.customerName} cancelled ${b.partySize} spot(s).`,
    heading: `Booking cancelled · <span style="white-space:nowrap">${escapeHtml(b.reference)}</span>`,
    body: `<p style="margin:10px 0 0;font:14px/1.5 ${SANS};color:${C.dim}">The customer cancelled with their Manage Booking link. The spots are free again.</p>
      ${refund}${detailsTable(rows, "#e6e2db")}${adminButton()}`,
  }), `Booking cancelled by the customer${opts.refundRequested ? " (refund requested: issue it in Admin → Payments)" : ""}\n\n${textBlock(rows)}\n\nAdmin dashboard: ${siteUrl()}/admin/`);
}
