// Signed "manage your booking" links: <booking id>.<HMAC>. Nothing secret is
// stored in the database, and links can be re-created for emails at any time.
const encoder = new TextEncoder();

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("MANAGE_LINK_SECRET");
  if (!secret || secret.length < 32) throw new Error("MANAGE_LINK_SECRET missing or too short");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const toB64Url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function makeManageToken(bookingId: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), encoder.encode(`booking:${bookingId}`));
  return `${bookingId}.${toB64Url(sig)}`;
}

// Returns the booking id if the token is authentic, otherwise null.
export async function verifyManageToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length > 200) return null;
  const [bookingId, sig] = token.split(".");
  if (!bookingId || !sig || !/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64Url(sig), encoder.encode(`booking:${bookingId}`));
    return ok ? bookingId : null;
  } catch {
    return null;
  }
}
