// notify-feedback Edge Function — emails support when new in-app feedback arrives.
//
// Fired per-row by the AFTER INSERT trigger on public.feedback (feedback_notify_ins
// → fire_feedback_notify), invoked over pg_net with a service-role bearer. It loads
// the row, resolves the submitter's email + name + company, emails FEEDBACK_NOTIFY_TO
// with Reply-To = the submitter (so hitting Reply reaches the customer directly),
// then stamps notified_at. Idempotent: skips a row that's already notified.
//
// Auth: internal only (service-role bearer, verify_jwt=true at the gateway).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { defaultFrom, sendEmail } from "../_shared/email.ts";
import { logCloudEvent, logToCloud } from "../_shared/logToCloud.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

const TAG = "[notify-feedback]";
const SOURCE = "ef:notify-feedback";

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

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Row id from the trigger payload.
  let id: string | null = null;
  try {
    const body = await req.json();
    id = typeof body?.id === "string" ? body.id : null;
  } catch (_) {
    /* fall through to missing_id */
  }
  if (!id) return json({ error: "missing_id" }, 400);

  try {
    // 1. Load the feedback row.
    const { data: fb, error: fbErr } = await admin
      .from("feedback")
      .select(
        "id, user_id, org_sk, body, category, app_version, platform, status, created_at, notified_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (fbErr) throw fbErr;
    if (!fb) return json({ error: "not_found" }, 404);
    if (fb.notified_at) return json({ skipped: "already_notified" });

    // 2. Resolve who submitted it: auth email + name + company (all best-effort).
    let submitterEmail: string | null = null;
    if (fb.user_id) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(fb.user_id);
        submitterEmail = u?.user?.email ?? null;
      } catch (_) {
        /* leave null */
      }
    }

    let who = "";
    let orgName = "";
    if (fb.user_id) {
      const { data: profile } = await admin
        .from("users")
        .select("org_sk, fname, lname")
        .eq("id", fb.user_id)
        .maybeSingle();
      who = [profile?.fname, profile?.lname].filter(Boolean).join(" ").trim();
      const orgSk = profile?.org_sk ?? fb.org_sk ?? null;
      if (orgSk) {
        const { data: org } = await admin
          .from("organizations")
          .select("org_name")
          .eq("org_sk", orgSk)
          .maybeSingle();
        orgName = org?.org_name ?? "";
      }
    }

    // 3. Where to send.
    const to = Deno.env.get("FEEDBACK_NOTIFY_TO");
    if (!to) {
      await logToCloud(admin, {
        level: "warn",
        event: "feedback.notify.no_recipient",
        source: SOURCE,
        message: "FEEDBACK_NOTIFY_TO not set",
        data: { id },
      });
      return json({ error: "no_recipient" }, 500);
    }

    // 4. Compose + send. Reply-To = the customer, so a reply reaches them.
    const label = orgName || who || submitterEmail || "a Zanbi user";
    const subject = `New Zanbi feedback — ${label}`;
    const metaLine = [
      submitterEmail
        ? `From: ${who ? who + " · " : ""}${submitterEmail}`
        : "From: (no email on file)",
      orgName ? `Company: ${orgName}` : null,
      `Platform: ${fb.platform ?? "?"} · App: ${fb.app_version ?? "?"}`,
      fb.created_at ? `Submitted: ${new Date(fb.created_at).toISOString()}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const text =
      `${fb.body}\n\n—\n${metaLine}\n\nReply to this email to respond directly to the customer.`;
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">` +
      `<p style="font-size:16px;line-height:1.5;white-space:pre-wrap;margin:0 0 16px">${esc(fb.body)}</p>` +
      `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />` +
      `<p style="font-size:13px;color:#6b7280;line-height:1.6;white-space:pre-wrap;margin:0">${esc(metaLine)}</p>` +
      `<p style="font-size:13px;color:#6b7280;margin:12px 0 0">Reply to this email to respond directly to the customer.</p>` +
      `</div>`;

    const res = await sendEmail({
      to: [to],
      subject,
      html,
      text,
      from: defaultFrom(),
      replyTo: submitterEmail ?? undefined,
    });

    if (!res.ok) {
      await logToCloud(admin, {
        level: "error",
        event: "feedback.notify.failed",
        source: SOURCE,
        message: res.error,
        userId: fb.user_id,
        orgSk: fb.org_sk,
        data: { id },
      });
      return json({ error: res.error ?? "send_failed" }, 502);
    }

    // 5. Stamp notified_at so it's never re-sent.
    await admin
      .from("feedback")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);

    await logCloudEvent(admin, SOURCE, "feedback.notify.sent", {
      userId: fb.user_id,
      orgSk: fb.org_sk,
      data: { id, emailId: res.id },
    });
    return json({ ok: true, id: res.id });
  } catch (e) {
    console.error(`${TAG} error`, (e as Error)?.message ?? String(e));
    return json({ error: (e as Error)?.message ?? "error" }, 500);
  }
});
