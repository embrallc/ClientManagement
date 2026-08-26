// resend-report Edge Function (user-invoked "Send report to client").
//
// The device taps "Send" in the report viewer; this picks up the MOST RECENT
// already-generated PDF for the inspection (no re-render — if they want a fresh
// one they hit Generate first), signs a long-TTL link, and emails it to every
// address registered on the REPORT channel via Resend. Cross-platform by design:
// nothing depends on the device's mail app.
//
// On a successful send it marks report_state='sent' (the server-owned auto-send
// gate). This is intentional: a manual send means the owner is delivering the
// report themselves, so it BOTH suppresses auto-send-on-complete (no duplicate)
// AND drives the "Report sent" badge in the Completed archive — the signal a
// no-auto-send owner uses to see which completed reports still need sending.
// Best-effort event log too.
//
// Payment gate: when the org's "Require Payment First" is on and the inspection
// is unpaid, a plain send is HELD (report_state='held', no email) instead of
// delivered — the gate is enforced here, not just on auto-send. The owner can
// force delivery with override=true (the app's "Send anyway without payment?"
// confirmation on a completed, held report).
//
// Auth: a normal user JWT (verify_jwt=true). The inspection must belong to the
// caller. Body: { inspectionSk, override? }. Returns { ok, recipientCount },
// { ok:false, error:"payment_required", held:true }, or { ok:false, error }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildCompleteNoticeEmail,
  buildReportEmail,
  channelRecipients,
  sendEmail,
} from "../_shared/email.ts";
import { computeReportTypes } from "../_shared/reportTypes.ts";
import { logCloudEvent, logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[resend-report]";
const SOURCE = "ef:resend-report";
const REPORT_BUCKET = "inspection-reports";
const LINK_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — matches auto-send.

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

// Read the row's current _version and write a patch with _version+1 so synced
// devices pull the change (mirrors reconcile-inspection's helper).
async function bumpedUpdate(
  admin: SupabaseClient,
  inspectionSk: string,
  patch: Record<string, unknown>,
) {
  const { data: cur } = await admin
    .from("inspections")
    .select("_version")
    .eq("inspection_sk", inspectionSk)
    .maybeSingle();
  const nextVersion = Number(cur?._version ?? 1) + 1;
  return admin
    .from("inspections")
    .update({ ...patch, _version: nextVersion, _last_changed_at: Date.now() })
    .eq("inspection_sk", inspectionSk);
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
  // send its report).
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "missing_token" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const userId = userData.user.id;

  let body: { inspectionSk?: string; override?: boolean } = {};
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
      "inspection_sk, user_id, org_sk, full_name, address_line1, city, state, email, report_recipients, report_state, paid, status, policy_require_payment_first, report_pdf, report_online",
    )
    .eq("inspection_sk", inspectionSk)
    .maybeSingle();
  if (inspErr) {
    console.error(`${TAG} inspection_lookup_failed`, inspErr.message);
    return json({ ok: false, error: "db_error" }, 500);
  }
  if (!insp) return json({ ok: false, error: "inspection_not_found" }, 404);
  if (insp.user_id !== userId) return json({ ok: false, error: "forbidden" }, 403);

  // 2.5. Payment gate — "Require Payment First" is enforced on the manual send
  // path too, not just auto-send. When it's on and the inspection is unpaid, a
  // plain Send does NOT email the client: it HOLDS the report (report_state=
  // 'held' → the "awaiting payment" badge) and returns so the app can tell the
  // owner. The owner forces delivery by passing override=true (the app's
  // "Send anyway without payment?" confirmation on a completed, held report).
  // The gate value is the frozen per-inspection policy once completed; before
  // completion it isn't frozen yet, so fall back to the org's live toggle.
  const paid = insp.paid === true;
  let gate = insp.policy_require_payment_first;
  if (gate === null || gate === undefined) {
    if (insp.org_sk) {
      const { data: org } = await admin
        .from("organizations")
        .select("require_payment_first")
        .eq("org_sk", insp.org_sk)
        .maybeSingle();
      gate = !!org?.require_payment_first;
    } else {
      gate = false;
    }
  }
  const override = body.override === true;
  if (gate && !paid && !override) {
    // Move it into 'held' from any not-yet-delivered state so the badge reflects
    // the hold; never step on a report that's already sent/sending/held.
    const rs = insp.report_state;
    if (rs !== "sent" && rs !== "sending" && rs !== "held") {
      await bumpedUpdate(admin, inspectionSk, { report_state: "held" });
    }
    void logCloudEvent(admin, SOURCE, "report.held", {
      userId,
      orgSk: insp.org_sk ?? null,
      data: { inspectionSk, reason: "payment_required" },
    });
    return json({ ok: false, error: "payment_required", held: true }, 200);
  }

  // 3. Recipients — everyone on the REPORT channel (same selection as auto-send).
  const recipients = channelRecipients(insp.report_recipients, insp.email, "report");
  if (recipients.length === 0) return json({ ok: false, error: "no_recipients" }, 200);

  // 4. Newest already-generated PDF. No re-render: Generate makes a fresh one,
  // Send mails the latest. None yet → tell the app to generate first.
  const { data: latest } = await admin
    .from("inspection_reports")
    .select("storage_path, model_path, generated_at")
    .eq("inspection_sk", inspectionSk)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const who = insp.full_name || "there";
  const addr = [insp.address_line1, insp.city, insp.state].filter(Boolean).join(", ");

  // 4.5. Report Types — which artifacts this client gets. Per-inspection flags
  // come off the inspection row; the org master/default flags off the org row.
  let orgFlags: Record<string, unknown> | null = null;
  if (insp.org_sk) {
    const { data: org } = await admin
      .from("organizations")
      .select(
        "report_pdf_enabled, report_online_enabled, report_pdf_default, report_online_default",
      )
      .eq("org_sk", insp.org_sk)
      .maybeSingle();
    orgFlags = org ?? null;
  }
  const { makePdf, makeOnline } = computeReportTypes(
    { report_pdf: insp.report_pdf, report_online: insp.report_online },
    orgFlags,
  );

  // Neither type enabled → send the short "your inspection is complete" note and
  // still claim the send (owner delivered something; suppresses auto-send).
  if (!makePdf && !makeOnline) {
    const emailBody = buildCompleteNoticeEmail({ fullName: who, addr });
    const sent = await sendEmail({ to: recipients, ...emailBody });
    if (!sent.ok) {
      await logToCloud(admin, {
        level: "error",
        event: "report.resend.failed",
        message: sent.error,
        context: `resend-report inspection=${inspectionSk}`,
        userId,
        orgSk: insp.org_sk ?? null,
        source: SOURCE,
      });
      return json({ ok: false, error: "email_failed", detail: sent.error }, 200);
    }
    await logCloudEvent(admin, SOURCE, "report.resent", {
      userId,
      orgSk: insp.org_sk ?? null,
      data: {
        inspectionSk,
        recipientCount: recipients.length,
        id: sent.id,
        kind: "complete_notice",
      },
    });
    if (insp.report_state !== "sent") {
      await bumpedUpdate(admin, inspectionSk, { report_state: "sent" });
    }
    return json({ ok: true, recipientCount: recipients.length });
  }

  // 5. Build the links for the enabled types from the LATEST generated report
  // (resend reuses the latest render — Generate makes a fresh one). A PDF link
  // only if the org/inspection want a PDF and one exists; the interactive online
  // link only if they want online and a model exists (create/refresh the share).
  let pdfUrl: string | null = null;
  if (makePdf && latest?.storage_path) {
    const { data: signed, error: signErr } = await admin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(latest.storage_path, LINK_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      console.error(`${TAG} sign_failed`, signErr?.message);
    } else {
      pdfUrl = signed.signedUrl;
    }
  }

  let onlineUrl: string | null = null;
  if (makeOnline && latest?.model_path) {
    try {
      const { data: shareRow } = await admin
        .from("report_shares")
        .upsert(
          {
            inspection_sk: inspectionSk,
            org_sk: insp.org_sk ?? null,
            model_path: latest.model_path,
            report_generated_at: latest.generated_at ?? null,
            property_label: addr || null,
            authorized_emails: recipients, // already lowercased + de-duped
            created_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "inspection_sk" },
        )
        .select("share_token")
        .single();
      if (shareRow?.share_token) {
        // Staging shares live in the staging project; tag the link so the shared
        // getzanbi.com viewer talks to the right backend (prod needs no tag).
        const staging = (Deno.env.get("SUPABASE_URL") ?? "").includes(
          "agdnsnrbwqavqrdngpmh",
        );
        onlineUrl =
          `https://getzanbi.com/report?token=${shareRow.share_token}` +
          (staging ? "&env=staging" : "");
      }
    } catch (e) {
      console.error(`${TAG} share_upsert_failed`, (e as Error)?.message);
    }
  }

  // No artifact yet for any enabled type → tell the app to generate first.
  if (!pdfUrl && !onlineUrl) return json({ ok: false, error: "no_report" }, 200);

  const emailBody = buildReportEmail({ fullName: who, addr, pdfUrl, onlineUrl });
  const sent = await sendEmail({ to: recipients, ...emailBody });
  if (!sent.ok) {
    await logToCloud(admin, {
      level: "error",
      event: "report.resend.failed",
      message: sent.error,
      context: `resend-report inspection=${inspectionSk}`,
      userId,
      orgSk: insp.org_sk ?? null,
      source: SOURCE,
    });
    return json({ ok: false, error: "email_failed", detail: sent.error }, 200);
  }

  await logCloudEvent(admin, SOURCE, "report.resent", {
    userId,
    orgSk: insp.org_sk ?? null,
    data: { inspectionSk, recipientCount: recipients.length, id: sent.id },
  });

  // Claim the report as sent (server-owned state; the device never pushes it,
  // always pulls it). A manual send deliberately owns delivery: setting 'sent'
  // suppresses auto-send-on-complete (the reconciler only sends from
  // pending/held/failed) AND drives the "Report sent" badge in the Completed
  // archive. Applies whether the inspection is still open or already closed;
  // skipped when already 'sent' (no redundant version bump).
  if (insp.report_state !== "sent") {
    await bumpedUpdate(admin, inspectionSk, { report_state: "sent" });
  }

  return json({ ok: true, recipientCount: recipients.length });
});
