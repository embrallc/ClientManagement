// report-html — step 3 of the hosted report viewer's email-2FA.
//
// Body: { shareToken, sessionToken }. Validates the opaque session (bound to the
// share, unexpired, not revoked; the share itself live), loads the frozen
// ReportModel the share points at, signs photo paths fresh (short TTL), and
// returns self-contained HTML — the SAME renderer the in-app view uses. The SPA
// drops the HTML into a sandboxed <iframe srcdoc>.
//
// verify_jwt=false: authorization is the session token, not a Supabase JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { renderReportHtml } from "../_shared/renderReportHtml.js";
import { logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[report-html]";
const SOURCE = "ef:report-html";
const REPORT_BUCKET = "inspection-reports"; // PDFs + model.json (private)
const IMAGE_BUCKET = "inspection-images"; // inspection photos (private)
const PHOTO_TTL_SECONDS = 60 * 60 * 2; // 2h — a comfortable viewing session.

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

function collectPhotoPaths(model: any): string[] {
  const set = new Set<string>();
  for (const sec of model?.sections ?? []) {
    for (const inst of sec?.instances ?? []) {
      for (const ph of inst?.photos ?? []) {
        if (ph?.path) set.add(ph.path);
      }
    }
  }
  return [...set];
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

  let body: { shareToken?: string; sessionToken?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const shareToken = typeof body.shareToken === "string" ? body.shareToken : "";
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  if (!shareToken || !sessionToken) {
    return json({ ok: false, error: "session_expired" }, 401);
  }

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validate the session: exists, bound to this share, live.
  const { data: session } = await admin
    .from("report_sessions")
    .select("session_token, share_token, email, expires_at, revoked_at")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (
    !session ||
    session.share_token !== shareToken ||
    session.revoked_at ||
    new Date(session.expires_at) < new Date()
  ) {
    return json({ ok: false, error: "session_expired" }, 401);
  }

  // 2. Load the share it points at; must still be live.
  const { data: share } = await admin
    .from("report_shares")
    .select("share_token, model_path, org_sk, revoked_at, expires_at")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (
    !share ||
    share.revoked_at ||
    (share.expires_at && new Date(share.expires_at) < new Date())
  ) {
    return json({ ok: false, error: "unavailable" }, 200);
  }
  if (!share.model_path) return json({ ok: false, error: "no_model" }, 200);

  // 3. Load the frozen model JSON.
  let model: any;
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(REPORT_BUCKET)
      .download(share.model_path);
    if (dlErr || !blob) throw dlErr ?? new Error("empty download");
    model = JSON.parse(await blob.text());
  } catch (e) {
    console.error(`${TAG} model_download_failed`, (e as Error)?.message);
    return json({ ok: false, error: "model_unavailable" }, 200);
  }

  // 4. Sign every photo path fresh (short TTL); build a path → URL map.
  const urlByPath = new Map<string, string>();
  const paths = collectPhotoPaths(model);
  if (paths.length) {
    try {
      const { data: signed, error: signErr } = await admin.storage
        .from(IMAGE_BUCKET)
        .createSignedUrls(paths, PHOTO_TTL_SECONDS);
      if (signErr) throw signErr;
      for (const s of signed ?? []) {
        if (s?.signedUrl && !s.error && s.path) urlByPath.set(s.path, s.signedUrl);
      }
    } catch (e) {
      console.error(`${TAG} photo_sign_failed`, (e as Error)?.message);
    }
  }

  // 5. Render (same template as the in-app view).
  let html: string;
  try {
    html = renderReportHtml(model, {
      photoSrc: (p: { path?: string }) => (p?.path ? urlByPath.get(p.path) ?? null : null),
      photosPerRow: "auto",
    });
  } catch (e) {
    console.error(`${TAG} render_failed`, (e as Error)?.message);
    await logToCloud(admin, {
      level: "error",
      event: "report.html.render_failed",
      message: (e as Error)?.message,
      context: `report-html share=${shareToken}`,
      orgSk: share.org_sk ?? null,
      source: SOURCE,
    });
    return json({ ok: false, error: "render_failed" }, 200);
  }

  // 6. Record the view (best-effort; drives engagement analytics).
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
    await admin.from("report_views").insert({
      share_token: shareToken,
      email: session.email,
      ip,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch (e) {
    console.error(`${TAG} view_insert_failed`, (e as Error)?.message);
  }

  return json({ ok: true, html, generatedAt: model?.generatedAt ?? null });
});
