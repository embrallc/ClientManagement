// resend-invoice Edge Function (user-invoked "Email invoice to client").
//
// The device taps "Email" in the Request Payment sheet after creating a Stripe
// checkout link; this picks up that inspection's most recent open payment link
// and emails it — as ONE message addressed to every address on the INVOICE
// channel (same selection as auto-send-invoice) — via Resend. Cross-platform by
// design: nothing depends on the device's mail app, and it never opens a
// per-recipient email.
//
// It does NOT touch payment_state: creating the link already set it to
// 'requested' (the "Billed" badge), so emailing is pure delivery. Best-effort
// event log only.
//
// Auth: a normal user JWT (verify_jwt=true). The inspection must belong to the
// caller. Body: { inspectionSk }. Returns { ok, recipientCount } or
// { ok:false, error } (no_invoice | no_recipients | email_failed | ...).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildInvoiceEmail, channelRecipients, sendEmail } from "../_shared/email.ts";
import { logCloudEvent, logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[resend-invoice]";
const SOURCE = "ef:resend-invoice";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    console.error(`${TAG} missing_env`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // 1. Auth — resolve the caller from their JWT (only the inspection's owner may
  // send its invoice).
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "missing_token" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const userId = userData.user.id;

  let body: { inspectionSk?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const inspectionSk = body.inspectionSk;
  if (!inspectionSk) return json({ ok: false, error: "missing_inspection" }, 400);

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Load + authorize the inspection.
  const { data: insp, error: inspErr } = await admin
    .from("inspections")
    .select(
      "inspection_sk, user_id, org_sk, full_name, address_line1, city, state, email, report_recipients",
    )
    .eq("inspection_sk", inspectionSk)
    .maybeSingle();
  if (inspErr) {
    console.error(`${TAG} inspection_lookup_failed`, inspErr.message);
    return json({ ok: false, error: "db_error" }, 500);
  }
  if (!insp) return json({ ok: false, error: "inspection_not_found" }, 404);
  if (insp.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

  // 3. Newest still-open payment link. The stored checkout_url IS the link
  // stripe-create-checkout minted; no re-mint here. None → tell the app to
  // create one first.
  const { data: reqs } = await admin
    .from("payment_requests")
    .select("checkout_url, status")
    .eq("inspection_sk", inspectionSk)
    .in("status", ["created", "open"])
    .order("created_at", { ascending: false })
    .limit(1);
  const checkoutUrl = reqs?.[0]?.checkout_url ?? null;
  if (!checkoutUrl) return json({ ok: false, error: "no_invoice" }, 200);

  // 4. Recipients — everyone on the INVOICE channel (same selection as auto-send).
  const recipients = channelRecipients(insp.report_recipients, insp.email, "invoice");
  if (recipients.length === 0) return json({ ok: false, error: "no_recipients" }, 200);

  // 5. Send ONE email to all recipients (Resend puts them all on To).
  const { subject, html, text } = buildInvoiceEmail({
    fullName: insp.full_name,
    addressLine1: insp.address_line1,
    city: insp.city,
    state: insp.state,
    checkoutUrl,
  });
  const sent = await sendEmail({ to: recipients, subject, html, text });
  if (!sent.ok) {
    await logToCloud(admin, {
      level: "error",
      event: "invoice.resend.failed",
      message: sent.error,
      context: `resend-invoice inspection=${inspectionSk}`,
      userId,
      orgSk: insp.org_sk ?? null,
      source: SOURCE,
    });
    return json({ ok: false, error: "email_failed", detail: sent.error }, 200);
  }

  await logCloudEvent(admin, SOURCE, "invoice.resent", {
    userId,
    orgSk: insp.org_sk ?? null,
    data: { inspectionSk, recipientCount: recipients.length, id: sent.id },
  });

  return json({ ok: true, recipientCount: recipients.length });
});
