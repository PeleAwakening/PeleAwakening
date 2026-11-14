import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@16.12.0";

// Service-role client: bypasses RLS, so it exists only here, server-side.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Live keys are refused unless ALLOW_LIVE_PAYMENTS=true is set deliberately
// after pricing and Stripe configuration are approved.
export function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("stripe_not_configured");
  if (key.startsWith("sk_live_") && Deno.env.get("ALLOW_LIVE_PAYMENTS") !== "true") {
    throw new Error("live_payments_not_approved");
  }
  return new Stripe(key, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const stripeCrypto = Stripe.createSubtleCryptoProvider();

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://peleawakening.com").replace(/\/$/, "");
}
