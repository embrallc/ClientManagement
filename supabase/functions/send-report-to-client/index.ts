// send-report-to-client Edge Function (internal-only).
//
// Ensures the inspection has a rendered PDF (rendering one via the Railway
// worker's /api/render-internal if needed), signs a long-TTL link, and emails it
// to the inspection's report recipients via Resend. Called by reconcile-inspection;
// it owns no state — the reconciler claims report_state='sending' around it.
//
// Auth: the caller must present the service-role key as the bearer (trusted
// server-to-server). User JWTs are rejected.
//
// Body: { inspectionSk }. Returns: { ok, recipientCount } or { ok:false, error }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createClient,
  SupabaseClient,
} from "npm:@supabase/supabase-js@2";
import {
  buildCompleteNoticeEmail,
  buildReportEmail,
  channelRecipients,
  sendEmail,
} from "../_shared/email.ts";
import { computeReportTypes } from "../_shared/reportTypes.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[send-report-to-client]";
const REPORT_BUCKET = "inspection-reports";
const LINK_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function logInfo(event: string, fields: Record<string, unknown> = {}) {
  console.log(`${TAG} ${event}`, JSON.stringify(fields));
}
function logError(event: string, err: unknown, fields: Record<string, unknown> = {}) {
  const anyErr = err as Record<string, unknown> | null | undefined;
  console.error(
    `${TAG} ${event}`,
    JSON.stringify({
      ...fields,
      error: err instanceof Error ? err.message : (anyErr?.message ?? String(err)),
    }),
  );
}

// Minutes east of UTC for an IANA timezone at "now" — so the auto-generated
// report stamps local times rather than UTC.
function tzOffsetMinutes(timeZone: string | null): number {
  if (!timeZone) return 0;
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const m: Record<string, string> = {};
    for (const p of dtf.formatToParts(now)) m[p.type] = p.value;
    const asUTC = Date.UTC(
      +m.year,
      +m.month - 1,
      +m.day,
      +m.hour,
      +m.minute,
      +m.second,
    );
    return Math.round((asUTC - now.getTime()) / 60000);
  } catch (_) {
    return 0;
  }
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt !== serviceKey) return json({ error: "forbidden" }, 403);

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: { inspectionSk?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }
  const inspectionSk = body.inspectionSk;
  if (!inspectionSk) return json({ ok: false, error: "missing_inspection" }, 400);

  // Load the inspection + recipients.
  const { data: insp, error: inspErr } = await admin
    .from("inspections")
    .select(
      "inspection_sk, user_id, org_sk, full_name, address_line1, city, state, email, report_recipients, report_pdf, report_online",
    )
    .eq("inspection_sk", inspectionSk)
    .maybeSingle();
  if (inspErr) {
    logError("inspection_lookup_failed", inspErr, { inspectionSk });
    return json({ ok: false, error: "db_error" }, 500);
  }
  if (!insp) return json({ ok: false, error: "inspection_not_found" }, 404);

  // Recipients = whoever is subscribed to the report channel (new object form),
  // or everyone + primary (legacy form).
  const recipients = channelRecipients(
    insp.report_recipients,
    insp.email,
    "report",
  );
  if (recipients.length === 0) {
    logInfo("no_recipients", { inspectionSk });
    return json({ ok: false, error: "no_recipients" }, 200);
  }

  // Resolve the org (the inspection's own org_sk, or the owner's as a fallback)
  // and read its timezone + Report Types flags together.
  let orgSk: string | null = insp.org_sk ?? null;
  if (!orgSk && insp.user_id) {
    const { data: owner } = await admin
      .from("users")
      .select("org_sk")
      .eq("id", insp.user_id)
      .maybeSingle();
    orgSk = owner?.org_sk ?? null;
  }
  let orgTz: string | null = null;
  let orgFlags: Record<string, unknown> | null = null;
  if (orgSk) {
    const { data: org } = await admin
      .from("organizations")
      .select(
        "timezone, report_pdf_enabled, report_online_enabled, report_pdf_default, report_online_default",
      )
      .eq("org_sk", orgSk)
      .maybeSingle();
    orgTz = (org?.timezone as string | null) ?? null;
    orgFlags = org ?? null;
  }

  // Report Types — which artifacts this client gets on completion.
  const { makePdf, makeOnline } = computeReportTypes(
    { report_pdf: insp.report_pdf, report_online: insp.report_online },
    orgFlags,
  );

  const who = insp.full_name || "there";
  const addr = [insp.address_line1, insp.city, insp.state]
    .filter(Boolean)
    .join(", ");

  // Neither type enabled → email a short "your inspection is complete" note
  // instead of a report. A successful outcome (report_state -> 'sent'), not a skip.
  if (!makePdf && !makeOnline) {
    const emailBody = buildCompleteNoticeEmail({ fullName: who, addr });
    const sent = await sendEmail({ to: recipients, ...emailBody });
    if (!sent.ok) {
      logError("complete_notice_failed", new Error(sent.error), { inspectionSk });
      return json({ ok: false, error: "email_failed", detail: sent.error }, 200);
    }
    logInfo("complete_notice_sent", {
      inspectionSk,
      recipientCount: recipients.length,
    });
    return json({
      ok: true,
      recipientCount: recipients.length,
      kind: "complete_notice",
    });
  }

  // Always render FRESH right before sending, honoring the report-type flags, so
  // the client's authoritative copy reflects the CURRENT cloud answers (never a
  // cached earlier render). render-internal produces ONLY the requested artifacts
  // and returns their paths + which it actually made. Service-role bearer =
  // trusted server-to-server.
  const workerUrl = (Deno.env.get("REPORT_WORKER_URL") ?? "").replace(/\/$/, "");
  if (!workerUrl) {
    logError("worker_not_configured", new Error("REPORT_WORKER_URL not set"), {
      inspectionSk,
    });
    return json({ ok: false, error: "generate_failed" }, 200);
  }
  let storagePath: string | null = null;
  let modelPath: string | null = null;
  let generatedAt: string | null = null;
  let madePdf = false;
  let madeOnline = false;
  try {
    const res = await fetch(`${workerUrl}/api/render-internal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inspectionSk,
        tzOffsetMinutes: tzOffsetMinutes(orgTz),
        makePdf,
        makeOnline,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logError("generate_failed", new Error(data?.error ?? `status ${res.status}`), {
        inspectionSk,
      });
      return json({ ok: false, error: "generate_failed" }, 200);
    }
    storagePath = data?.storagePath ?? null;
    modelPath = data?.modelPath ?? null;
    generatedAt = data?.generatedAt ?? null;
    madePdf = data?.madePdf === true && !!storagePath;
    madeOnline = data?.madeOnline === true && !!modelPath;
  } catch (e) {
    logError("generate_threw", e, { inspectionSk });
    return json({ ok: false, error: "generate_failed" }, 200);
  }

  // PDF link (signed, long TTL) when a PDF was produced.
  let pdfUrl: string | null = null;
  if (madePdf && storagePath) {
    const { data: signed, error: signErr } = await admin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(storagePath, LINK_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      logError("sign_failed", signErr, { storagePath });
    } else {
      pdfUrl = signed.signedUrl;
    }
  }

  // Online link — create/refresh the client share (email-2FA) when a model was
  // produced, so the client can open the interactive report at getzanbi.com/report.
  // Mirrors resend-report's share upsert; best-effort.
  let onlineUrl: string | null = null;
  if (madeOnline && modelPath) {
    try {
      const { data: shareRow } = await admin
        .from("report_shares")
        .upsert(
          {
            inspection_sk: inspectionSk,
            org_sk: orgSk,
            model_path: modelPath,
            report_generated_at: generatedAt ?? new Date().toISOString(),
            property_label: addr || null,
            authorized_emails: recipients,
            created_by: insp.user_id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "inspection_sk" },
        )
        .select("share_token")
        .single();
      if (shareRow?.share_token) {
        const staging = (Deno.env.get("SUPABASE_URL") ?? "").includes(
          "agdnsnrbwqavqrdngpmh",
        );
        onlineUrl =
          `https://getzanbi.com/report?token=${shareRow.share_token}` +
          (staging ? "&env=staging" : "");
      }
    } catch (e) {
      logError("share_upsert_failed", e, { inspectionSk });
    }
  }

  // Intended to deliver a report but produced no usable link → a real failure.
  // Let the reconciler mark it 'failed' + retry rather than mask it.
  if (!pdfUrl && !onlineUrl) {
    logError("no_deliverable", new Error("render produced no links"), {
      inspectionSk,
      makePdf,
      makeOnline,
    });
    return json({ ok: false, error: "generate_failed" }, 200);
  }

  const emailBody = buildReportEmail({ fullName: who, addr, pdfUrl, onlineUrl });
  const sent = await sendEmail({ to: recipients, ...emailBody });
  if (!sent.ok) {
    logError("email_failed", new Error(sent.error), { inspectionSk });
    return json({ ok: false, error: "email_failed", detail: sent.error }, 200);
  }

  logInfo("sent", {
    inspectionSk,
    recipientCount: recipients.length,
    id: sent.id,
    pdf: !!pdfUrl,
    online: !!onlineUrl,
  });
  return json({ ok: true, recipientCount: recipients.length });
});
