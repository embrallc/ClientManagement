// report-view Edge Function — serves the interactive HTML inspection report.
//
// The device opens the report viewer; this returns a self-contained HTML report
// for the inspection's MOST RECENT generated report, rendered from the frozen
// ReportModel JSON the report-worker stored beside the PDF (Phase 0). Photo
// paths in the model are signed fresh here (short TTL) so nothing in the model
// carries an expiring URL. The HTML is loaded straight into the app's WebView
// (works on iOS AND Android — unlike the PDF preview).
//
// Auth: a normal user JWT (verify_jwt=true). The inspection must belong to the
// caller. Body: { inspectionSk }. Returns { ok:true, html }, or
// { ok:false, error } for no_report / no_model / forbidden / not_found.
//
// no_model = the latest report predates Phase 0 (no model stored). The app
// falls back to the PDF and prompts a regenerate to enable the interactive view.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { renderReportHtml } from "../_shared/renderReportHtml.js";
import { logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[report-view]";
const SOURCE = "ef:report-view";
const REPORT_BUCKET = "inspection-reports"; // PDFs + model.json (private)
const IMAGE_BUCKET = "inspection-images"; // inspection photos (private)
const PHOTO_TTL_SECONDS = 60 * 60 * 2; // 2h — long enough for a viewing session.

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

// Collect every unique photo storage path referenced by the model.
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    console.error(`${TAG} missing_env`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // 1. Auth — resolve the caller from their JWT.
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

  // 2. Authorize — the inspection must belong to the caller.
  const { data: insp, error: inspErr } = await admin
    .from("inspections")
    .select("inspection_sk, user_id")
    .eq("inspection_sk", inspectionSk)
    .maybeSingle();
  if (inspErr) {
    console.error(`${TAG} inspection_lookup_failed`, inspErr.message);
    return json({ ok: false, error: "db_error" }, 500);
  }
  if (!insp) return json({ ok: false, error: "not_found" }, 404);
  if (insp.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

  // 3. Newest report for this inspection. The HTML must match the latest PDF, so
  // if the newest report predates Phase 0 (no model) we say so rather than render
  // a stale one — the app regenerates to enable the interactive view.
  const { data: latest } = await admin
    .from("inspection_reports")
    .select("storage_path, model_path, generated_at")
    .eq("inspection_sk", inspectionSk)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return json({ ok: false, error: "no_report" }, 200);
  if (!latest.model_path) return json({ ok: false, error: "no_model" }, 200);

  // 4. Load the frozen model JSON.
  let model: any;
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(REPORT_BUCKET)
      .download(latest.model_path);
    if (dlErr || !blob) throw dlErr ?? new Error("empty download");
    model = JSON.parse(await blob.text());
  } catch (e) {
    console.error(`${TAG} model_download_failed`, (e as Error)?.message);
    return json({ ok: false, error: "model_unavailable" }, 200);
  }

  // 5. Sign every photo path fresh (short TTL); build a path → URL map.
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
      // Non-fatal: the report still renders, photos degrade to placeholder tiles.
      console.error(`${TAG} photo_sign_failed`, (e as Error)?.message);
    }
  }

  // 6. Render. photoSrc resolves a model photo to its fresh signed URL; missing
  // → null → the renderer shows a labeled placeholder tile.
  let html: string;
  try {
    html = renderReportHtml(model, {
      photoSrc: (p: { path?: string }) => (p?.path ? urlByPath.get(p.path) ?? null : null),
      // photosPerRow (+ future owner report_prefs) would be read here; default "auto".
      photosPerRow: "auto",
    });
  } catch (e) {
    console.error(`${TAG} render_failed`, (e as Error)?.message);
    await logToCloud(admin, {
      level: "error",
      event: "report.view.render_failed",
      message: (e as Error)?.message,
      context: `report-view inspection=${inspectionSk}`,
      userId,
      source: SOURCE,
    });
    return json({ ok: false, error: "render_failed" }, 200);
  }

  return json({ ok: true, html, generatedAt: model?.generatedAt ?? latest.generated_at });
});
