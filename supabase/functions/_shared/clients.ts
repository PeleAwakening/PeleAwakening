import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@23.1.0";

// Service-role client: bypasses RLS, so it exists only here, server-side.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Use a restricted key (rk_…) with only the permissions listed in the README.
// Live keys are refused unless ALLOW_LIVE_PAYMENTS=true is set deliberately
// after pricing and Stripe configuration are approved.
export function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("stripe_not_configured");
  if (/^(sk|rk)_live_/.test(key) && Deno.env.get("ALLOW_LIVE_PAYMENTS") !== "true") {
    throw new Error("live_payments_not_approved");
  }
  return new Stripe(key, {
    apiVersion: "2026-10-28.endive",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const stripeCrypto = Stripe.createSubtleCryptoProvider();

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://peleawakening.com").replace(/\/$/, "");
}
