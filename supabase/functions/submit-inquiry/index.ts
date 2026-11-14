// POST /functions/v1/submit-inquiry
// Saves contact-form inquiries to Supabase. Runs alongside FormSubmit (which
// still emails aloha@peleawakening.com) until this path is tested.
import { isEmail, json, preflight, readJson, str } from "../_shared/http.ts";
import { serviceClient } from "../_shared/clients.ts";

const CONTACT_METHODS: Record<string, string> = { email: "email", text: "text", phone: "phone" };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const body = await readJson(req);
  if (!body) return json(req, { error: "Invalid request." }, 400);
  if (str(body._honey, 200)) return json(req, { ok: true }); // bot: accept silently

  const name = str(body.name, 120);
  const email = str(body.email, 254);
  const phone = str(body.phone, 40);
  const interest = str(body.interest, 120);
  const message = str(body.message, 5000);
  const contactMethod = str(body.contact_method, 20);
  if (!name || !isEmail(email) || !message) return json(req, { error: "Invalid request." }, 400);

  const db = serviceClient();
  const { data: customerId, error: custErr } = await db.rpc("upsert_customer", {
    p_email: email,
    p_name: name,
    p_phone: phone,
    p_contact: CONTACT_METHODS[contactMethod.toLowerCase()] ?? null,
    p_interests: interest ? [interest] : [],
  });
  if (custErr) {
    console.error("upsert_customer", custErr);
    return json(req, { error: "Could not save." }, 500);
  }

  const { error } = await db.from("inquiries").insert({
    customer_id: customerId,
    name,
    email,
    phone: phone || null,
    interest: interest || null,
    message,
    contact_method: contactMethod || null,
    source: "web",
  });
  if (error) {
    console.error("inquiry insert", error);
    return json(req, { error: "Could not save." }, 500);
  }
  return json(req, { ok: true });
});
