// report-otp-verify — step 2 of the hosted report viewer's email-2FA.
//
// Body: { shareToken, email, code }. Validates the latest unconsumed code for
// (share, email): not expired, under the attempt cap, hash matches (constant
// time). On success it consumes the code and mints an opaque, short-lived
// session token the SPA presents to report-html. Failures are generic so a
// caller can't mine which part was wrong.
//
// verify_jwt=false: self-authorizing (share + code), like report-otp-request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hashCode, constantTimeEqual, normalizeEmail } from "../_shared/otp.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[report-otp-verify]";
const MAX_ATTEMPTS = 5; // wrong guesses allowed against one code
const SESSION_TTL_MIN = 60; // viewing session lifetime

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

  let body: { shareToken?: string; email?: string; code?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const shareToken = typeof body.shareToken === "string" ? body.shareToken : "";
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!shareToken || !email || !code) {
    return json({ ok: false, error: "invalid_code" }, 200);
  }

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Share must exist and be live.
  const { data: share } = await admin
    .from("report_shares")
    .select("share_token, authorized_emails, revoked_at, expires_at")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!share || share.revoked_at ||
      (share.expires_at && new Date(share.expires_at) < new Date())) {
    return json({ ok: false, error: "invalid_or_expired" }, 200);
  }
  const authorized: string[] = Array.isArray(share.authorized_emails)
    ? share.authorized_emails.map((e: string) => (e || "").toLowerCase())
    : [];
  if (!authorized.includes(email)) {
    return json({ ok: false, error: "invalid_code" }, 200);
  }

  // 2. Latest unconsumed code for (share, email).
  const { data: row } = await admin
    .from("report_otp_codes")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("share_token", shareToken)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return json({ ok: false, error: "invalid_code" }, 200);
  if (new Date(row.expires_at) < new Date()) {
    return json({ ok: false, error: "code_expired" }, 200);
  }
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    return json({ ok: false, error: "too_many_attempts" }, 200);
  }

  // 3. Constant-time hash compare.
  const candidate = await hashCode(code, pepper);
  if (!constantTimeEqual(candidate, row.code_hash)) {
    await admin
      .from("report_otp_codes")
      .update({ attempts: (row.attempts ?? 0) + 1 })
      .eq("id", row.id);
    return json({ ok: false, error: "invalid_code" }, 200);
  }

  // 4. Success — consume the code, mint an opaque session.
  await admin
    .from("report_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  const expires_at = new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString();
  const { data: session, error: sessErr } = await admin
    .from("report_sessions")
    .insert({ share_token: shareToken, email, expires_at })
    .select("session_token, expires_at")
    .single();
  if (sessErr || !session) {
    console.error(`${TAG} session_insert_failed`, sessErr?.message);
    return json({ ok: false, error: "server_error" }, 500);
  }

  return json({
    ok: true,
    sessionToken: session.session_token,
    expiresAt: session.expires_at,
  });
});
