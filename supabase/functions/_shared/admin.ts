import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

// Returns the signed-in admin's user id, or null if the request is not from
// a Supabase Auth user listed in public.admins.
export async function requireAdmin(req: Request, db: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth?.user) return null;
  const { data: admin } = await db.from("admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  return admin ? auth.user.id : null;
}
