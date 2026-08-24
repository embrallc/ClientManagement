// report-otp-request — step 1 of the hosted report viewer's email-2FA.
//
// Body: { shareToken, email }. If `email` is on the share's authorized list, we
// email a fresh 6-digit code (stored only as a salted hash, short-lived,
// attempt-limited). The response is ALWAYS a uniform { ok:true } — it never
// reveals whether the share exists or the email is authorized (no enumeration).
//
// verify_jwt=false: the browser SPA calls this holding only the publishable
// apikey; this function does its own (share + authorized-email) authorization.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, buildOtpEmail } from "../_shared/email.ts";
import { generateCode, hashCode, normalizeEmail } from "../_shared/otp.ts";
import { logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[report-otp-request]";
const SOURCE = "ef:report-otp-request";
const CODE_TTL_MIN = 10; // code lifetime
const WINDOW_MIN = 10; // rate-limit window
const MAX_CODES_PER_WINDOW = 3; // per (share, email) within the window

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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error(`${TAG} missing_env`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  const pepper = Deno.env.get("REPORT_OTP_PEPPER") ?? "";

  let body: { shareToken?: string; email?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const shareToken = typeof body.shareToken === "string" ? body.shareToken : "";
  const email = normalizeEmail(body.email);

  // Uniform success no matter what happens below — the client can't distinguish
  // "sent" from "not authorized" from "no such share".
  const uniform = () => json({ ok: true });
  if (!shareToken || !email) return uniform();

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1. Load the share. Missing / revoked / expired → uniform (leak nothing).
    const { data: share } = await admin
      .from("report_shares")
      .select("share_token, authorized_emails, property_label, revoked_at, expires_at")
      .eq("share_token", shareToken)
      .maybeSingle();
    if (!share) return uniform();
    if (share.revoked_at) return uniform();
    if (share.expires_at && new Date(share.expires_at) < new Date()) return uniform();

    // 2. Authorize the email against the frozen report-channel list.
    const authorized: string[] = Array.isArray(share.authorized_emails)
      ? share.authorized_emails.map((e: string) => (e || "").toLowerCase())
      : [];
    if (!authorized.includes(email)) return uniform();

    // 3. Rate-limit per (share, email): cap codes issued within the window.
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count } = await admin
      .from("report_otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("share_token", shareToken)
      .eq("email", email)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_CODES_PER_WINDOW) {
      console.warn(`${TAG} rate_limited share=${shareToken}`);
      return uniform(); // silently drop — still uniform
    }

    // 4. Mint + store the hashed code.
    const code = generateCode(6);
    const code_hash = await hashCode(code, pepper);
    const expires_at = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
    const { error: insErr } = await admin.from("report_otp_codes").insert({
      share_token: shareToken,
      email,
      code_hash,
      expires_at,
    });
    if (insErr) {
      console.error(`${TAG} code_insert_failed`, insErr.message);
      return uniform();
    }

    // 5. Email it.
    const { subject, html, text } = buildOtpEmail({
      code,
      propertyLabel: share.property_label,
      ttlMinutes: CODE_TTL_MIN,
    });
    const sent = await sendEmail({ to: [email], subject, html, text });
    if (!sent.ok) {
      console.error(`${TAG} send_failed`, sent.error);
      await logToCloud(admin, {
        level: "warn",
        event: "report.otp.send_failed",
        message: sent.error,
        context: `report-otp-request share=${shareToken}`,
        source: SOURCE,
      });
    }
  } catch (e) {
    // Never leak internals; log and still return uniform.
    console.error(`${TAG} unexpected`, (e as Error)?.message);
  }

  return uniform();
});
