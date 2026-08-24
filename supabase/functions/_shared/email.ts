// Resend email wrapper. RESEND_API_KEY is a Supabase secret; the sending
// domain must be DNS-verified in Resend. The from address is configurable via
// REPORT_FROM_EMAIL (falls back to a reports@ address on the verified domain).

declare const Deno: { env: { get(name: string): string | undefined } };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function defaultFrom(): string {
  // Must be on the DNS-verified Resend domain (notifyinspection.embrallc.com).
  return (
    Deno.env.get("REPORT_FROM_EMAIL") ||
    "Zanbi <reports@notifyinspection.embrallc.com>"
  );
}

// Light sanity filter so a malformed recipient can't fail the whole send.
export function validEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    const s = typeof e === "string" ? e.trim().toLowerCase() : "";
    if (s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// Resolve which addresses receive a given channel from an inspection's
// report_recipients, tolerating both formats:
//   - NEW object form: { report: string[], invoice: string[] } — per-channel
//     subscriptions chosen in the app.
//   - LEGACY array form: [{ email, label }] | [] — everyone got the report and
//     only the payer (primary email) got the invoice.
export function channelRecipients(
  reportRecipients: unknown,
  primaryEmail: string | null | undefined,
  channel: "report" | "invoice",
): string[] {
  if (
    reportRecipients &&
    typeof reportRecipients === "object" &&
    !Array.isArray(reportRecipients)
  ) {
    const list = (reportRecipients as Record<string, unknown>)[channel];
    return validEmails(Array.isArray(list) ? list : []);
  }
  // Legacy fallback.
  const legacy = Array.isArray(reportRecipients)
    ? (reportRecipients as Array<{ email?: string } | string>).map((r) =>
        typeof r === "string" ? r : r?.email,
      )
    : [];
  if (channel === "report") return validEmails([...legacy, primaryEmail]);
  return validEmails([primaryEmail]);
}

// Invoice email body — the Stripe payment link delivered to the client. Shared
// by the auto-send path (stripe-create-checkout's autoEmailInvoice) and the
// manual "Email invoice" path (resend-invoice) so both stay byte-identical.
export function buildInvoiceEmail(opts: {
  fullName?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  checkoutUrl: string;
}): { subject: string; html: string; text: string } {
  const who = opts.fullName || "there";
  const addr = [opts.addressLine1, opts.city, opts.state]
    .filter(Boolean)
    .join(", ");
  const subject = `Your invoice${addr ? ` — ${addr}` : ""}`;
  const text =
    `Hi ${who},\n\nYour inspector has sent you an invoice. View the amount and ` +
    `pay securely here:\n${opts.checkoutUrl}\n\nThank you!`;
  const html =
    `<div style="font-family:-apple-system,system-ui,Segoe UI,sans-serif;color:#1c1c1e;line-height:1.5">` +
    `<p>Hi ${who},</p>` +
    `<p>Your inspector has sent you an invoice${addr ? ` for <strong>${addr}</strong>` : ""}.</p>` +
    `<p><a href="${opts.checkoutUrl}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">View &amp; pay invoice</a></p>` +
    `<p style="color:#888;font-size:13px">Or paste this link into your browser:<br>${opts.checkoutUrl}</p>` +
    `</div>`;
  return { subject, html, text };
}

// One-time passcode email for the hosted client report viewer (email-2FA). The
// recipient enters this code on the report page to unlock the interactive report.
// The code also appears in the subject so it's glanceable from a notification.
export function buildOtpEmail(opts: {
  code: string;
  propertyLabel?: string | null;
  ttlMinutes?: number;
}): { subject: string; html: string; text: string } {
  const addr = (opts.propertyLabel || "").trim();
  const ttl = opts.ttlMinutes ?? 10;
  const subject = `Your report access code: ${opts.code}`;
  const text =
    `Your Zanbi inspection report access code is ${opts.code}.\n\n` +
    `Enter it on the report page to view your report${addr ? ` for ${addr}` : ""}. ` +
    `This code expires in ${ttl} minutes.\n\n` +
    `If you didn't request this, you can safely ignore this email.`;
  const html =
    `<div style="font-family:-apple-system,system-ui,Segoe UI,sans-serif;color:#1c1c2e;line-height:1.5;max-width:460px">` +
    `<p>Here is your access code to view your inspection report${
      addr ? ` for <strong>${addr}</strong>` : ""
    }:</p>` +
    `<p style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f6f6fb;` +
    `border:1px solid #e4e4ee;border-radius:12px;padding:16px 0;text-align:center;` +
    `color:#1c1c2e;margin:18px 0">${opts.code}</p>` +
    `<p style="color:#5b5b6b;font-size:14px">Enter this code on the report page. ` +
    `It expires in ${ttl} minutes.</p>` +
    `<p style="color:#888;font-size:13px">If you didn't request this, you can safely ` +
    `ignore this email.</p>` +
    `</div>`;
  return { subject, html, text };
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
}: {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const recipients = (to ?? []).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: "no_recipients" };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from || defaultFrom(),
        to: recipients,
        subject,
        html,
        text,
        reply_to: replyTo,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
