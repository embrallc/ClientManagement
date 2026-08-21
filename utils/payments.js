import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Share } from "react-native";
import { setInspectionPaymentStateLocal } from "../db/inspections";
import { logError, logEvent } from "../db/logs";
import { useInspectionStore } from "../stores/useInspectionStore";
import { isOnline } from "./connectivity";
import { pushInspection, pushInspectionForm } from "./sync";
import { supabase } from "./supabase";

// Client-side wrappers for the Stripe Connect Edge Functions. All Stripe API
// work + the secret key live server-side; these just invoke the functions and
// open the hosted URLs. Errors are unwrapped from the FunctionsHttpError
// envelope (same pattern as utils/reports.js) and rethrown with a presentable
// message.

const INVOKE_TIMEOUT_MS = 30000;

async function invoke(name, body) {
  // Offline: fail instantly instead of waiting out the timeout below.
  if (!isOnline()) {
    const err = new Error("You're offline — connect to the internet and try again.");
    err.code = "offline";
    throw err;
  }
  // Race the call against a timeout so a hung request recovers the UI with a
  // clear message instead of spinning forever.
  let result;
  try {
    result = await Promise.race([
      supabase.functions.invoke(name, { body: body ?? {} }),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("The request timed out. Check your connection and try again."),
            ),
          INVOKE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    logError(e, `utils/payments.invoke ${name} (timeout/transport)`);
    const err = new Error(e?.message || "Request failed. Please try again.");
    err.code = "timeout";
    throw err;
  }
  const { data, error } = result;
  if (error) {
    let code = error.message ?? "Something went wrong.";
    let detail = code;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) code = parsed.error;
      // Prefer the human-readable detail (e.g. the exact Stripe message) when
      // the function provides one; fall back to the machine code.
      detail = parsed?.detail || parsed?.error || code;
    } catch (_) {}
    logError(error, `utils/payments.invoke ${name} code="${code}" detail="${detail}"`);
    const err = new Error(detail);
    err.code = code;
    throw err;
  }
  return data;
}

// The https landing page Stripe redirects to after a hosted flow. Stripe
// rejects custom app schemes, so we hand it this public Edge Function URL and
// it bounces back to the app's deep link (which WebBrowser watches for).
function stripeReturnUrl(deepLink) {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return `${base}/functions/v1/stripe-return?to=${encodeURIComponent(deepLink)}`;
}

// Owner: mint an onboarding Account Link and open it in a secure browser session.
// Resolves with the WebBrowser result ({ type: 'success' | 'cancel' | 'dismiss' });
// the caller should then refresh status to pick up the new capability flags.
export async function startStripeOnboarding() {
  // The deep link WebBrowser watches for to auto-close the session.
  const deepLink = Linking.createURL("payments-return");
  // The https URL Stripe redirects to (it rejects custom schemes); it bounces
  // to deepLink on load.
  const httpsReturn = stripeReturnUrl(deepLink);
  const data = await invoke("stripe-connect-onboard", {
    returnUrl: httpsReturn,
    refreshUrl: httpsReturn,
  });
  if (!data?.url) throw new Error("No onboarding link was returned.");
  return await WebBrowser.openAuthSessionAsync(data.url, deepLink);
}

// Owner: pull the live account status from Stripe (and mirror it server-side).
// Returns { hasAccount, chargesEnabled, payoutsEnabled, detailsSubmitted }.
export async function refreshPaymentStatus() {
  return await invoke("stripe-account-status", {});
}

// Any inspector: create (or reuse) a Stripe Checkout link for an inspection and
// return it. amountCents is required when no open session exists; on Resend the
// server reuses the still-open session and ignores the amount. Optimistically
// flips the in-memory inspection to payment_state='requested' and pushes the
// row so the server state is current. Throws on failure (e.code carries the
// machine reason, e.g. 'onboarding_incomplete').
export async function requestPayment(inspectionSk, amountCents) {
  // Make sure the cloud has this inspection AND its walkthrough answers BEFORE
  // the server bills it:
  //  - inspection row: the checkout function looks it up by sk, and a
  //    just-created inspection may not have synced yet (else `inspection_not_found`).
  //  - walkthrough form (inspection_forms): the report worker renders purely from
  //    the cloud. When payment is gated (require_payment_first) the report is
  //    rendered LATER by the Stripe webhook with NO device involved — so if the
  //    answers only rode the fire-and-forget completion push, they can still be
  //    in flight when the render fires, producing a header-only report (all
  //    sections blank). "Complete without invoice" then bill-later is exactly
  //    that path. Landing the form here — before the invoice exists, and always
  //    before payment — guarantees the cloud is complete for any later render.
  // Pushing here is safe: pushInspection omits the server-owned payment columns,
  // so it can't roll back a payment_state the server may later set.
  await Promise.all([
    pushInspection(inspectionSk),
    pushInspectionForm(inspectionSk),
  ]);

  const data = await invoke("stripe-create-checkout", { inspectionSk, amountCents });
  if (!data?.checkoutUrl) throw new Error("No payment link was returned.");

  logEvent("payment.requested", { sk: inspectionSk, amountCents });

  // Optimistic UI: the server already set 'requested' + bumped _version. Reflect
  // it BOTH in SQLite (so the archive badge + a later reopen keep showing it) and
  // in the active store (snappy ribbon), before the authoritative value syncs.
  // We deliberately do NOT pushInspection here: there's nothing device-owned to
  // push, and pushing our stale _version would roll back the server's bump and
  // strand the pulled payment_state.
  try {
    await setInspectionPaymentStateLocal(inspectionSk, "requested");
    const store = useInspectionStore.getState();
    const current = store.getById?.(inspectionSk) ?? null;
    if (current) store.update({ ...current, PaymentState: "requested" });
  } catch (_) {}

  return data; // { checkoutUrl, status, amountCents, reused }
}

// Share a checkout link via the OS share sheet (SMS / Mail / etc.).
export async function shareCheckoutLink(checkoutUrl, clientName) {
  const who = clientName ? ` for ${clientName}` : "";
  try {
    await Share.share({
      message: `Here is your secure payment link${who}: ${checkoutUrl}`,
      url: checkoutUrl,
    });
  } catch (e) {
    logError(e, "utils/payments.shareCheckoutLink");
  }
}

// Map the resend-invoice Edge Function's machine codes to presentable copy.
function friendlyInvoiceError(code) {
  switch (code) {
    case "no_invoice":
      return "Create the invoice link first, then email it.";
    case "no_recipients":
      return "No invoice email addresses are set for this inspection.";
    case "email_failed":
      return "The invoice email couldn't be sent. Please try again.";
    case "forbidden":
      return "You don't have access to send this invoice.";
    default:
      return "Couldn't send the invoice. Please try again.";
  }
}

// Server-side send: email the inspection's most recent open payment link to the
// invoice-channel recipients via Resend (the resend-invoice Edge Function) — ONE
// email to everyone, cross-platform (no device mail app). Reuses the link made by
// "Create Link" and does NOT change payment_state (the "Billed" badge is already
// set at link creation). Throws with a presentable `message`; resolves
// { recipientCount } on success. Mirrors utils/reports.emailReportToClient.
export async function emailInvoiceToClient(inspectionSk) {
  if (!inspectionSk) throw new Error("missing inspection");
  if (!isOnline()) {
    const err = new Error("You're offline — sending the invoice needs a connection.");
    err.presentable = true;
    throw err;
  }
  const { data, error } = await supabase.functions.invoke("resend-invoice", {
    body: { inspectionSk },
  });
  // Transport / non-2xx (401/403/5xx): unwrap the machine code from the envelope.
  if (error) {
    let code = "";
    try {
      const parsed = await error.context?.json?.();
      code = parsed?.error ?? "";
    } catch (_) {}
    logError(error, `utils/payments.emailInvoiceToClient sk=${inspectionSk} code="${code}"`);
    const e = new Error(friendlyInvoiceError(code));
    e.presentable = true;
    throw e;
  }
  // Business errors return 200 with { ok:false, error } (no_invoice/no_recipients/…).
  if (!data?.ok) {
    logError(
      new Error(data?.error ?? "unknown"),
      `utils/payments.emailInvoiceToClient sk=${inspectionSk}`,
    );
    const e = new Error(friendlyInvoiceError(data?.error));
    e.presentable = true;
    throw e;
  }
  logEvent("invoice.resent", { sk: inspectionSk, recipientCount: data.recipientCount });
  return { recipientCount: data.recipientCount };
}
