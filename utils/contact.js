// Shared "contact the client" helpers — opening the phone dialer, SMS composer,
// mail composer, and turn-by-turn navigation for an inspection. Extracted from
// InspectionCard so the same actions can live on any card (active, completed,
// cancelled, deleted, payment activity) without duplicating the logic.
import * as SMS from "expo-sms";
import { Alert, Linking, Platform } from "react-native";

export function formatAddress(inspection) {
  const parts = [
    inspection?.AddressLine1,
    inspection?.AddressLine2,
    inspection?.City,
    inspection?.State,
    inspection?.ZipCode,
  ];
  return parts.filter(Boolean).join(", ");
}

export async function openCall(phone) {
  if (!phone) {
    Alert.alert("No phone number on this inspection.");
    return;
  }
  await Linking.openURL(`tel:${phone}`);
}

// Every distinct email tied to an inspection: the primary Email column plus any
// report/invoice recipients (e.g. several addresses pulled from a calendar event's
// notes). Deduped, case-insensitive, first-seen order.
export function collectEmails(inspection) {
  const out = [];
  const seen = new Set();
  const add = (e) => {
    const v = (e || "").trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  add(inspection?.Email);
  try {
    const rr = inspection?.ReportRecipients
      ? JSON.parse(inspection.ReportRecipients)
      : null;
    if (Array.isArray(rr)) {
      // Legacy array-of-emails form.
      rr.forEach(add);
    } else if (rr && typeof rr === "object") {
      // Current per-channel form { report: [...], invoice: [...] }.
      (rr.report || []).forEach(add);
      (rr.invoice || []).forEach(add);
    }
  } catch (_) {}
  return out;
}

export async function openEmail(inspection) {
  const emails = collectEmails(inspection);
  if (!emails.length) {
    Alert.alert("No email address on this inspection.");
    return;
  }
  // mailto takes a comma-separated recipient list (RFC 6068).
  await Linking.openURL(`mailto:${emails.join(",")}`);
}

// Open the native SMS composer to the client, optionally prefilled with a body.
// Uses expo-sms when available, falling back to the sms: URL scheme. An empty
// body opens a blank message addressed to just the number.
export async function openSmsComposer(phone, body) {
  if (!phone) {
    Alert.alert("No phone number on this inspection.");
    return;
  }
  try {
    if (await SMS.isAvailableAsync()) {
      await SMS.sendSMSAsync([phone], body || "");
      return;
    }
  } catch (_) {
    // fall through to the URL-scheme fallback
  }
  const sep = Platform.OS === "ios" ? "&" : "?";
  const url = body
    ? `sms:${phone}${sep}body=${encodeURIComponent(body)}`
    : `sms:${phone}`;
  await Linking.openURL(url);
}

export async function openNavigation(inspection) {
  if (!inspection?.AddressLine1) {
    Alert.alert("No address on this inspection.");
    return;
  }
  const addr = formatAddress(inspection);
  const encoded = encodeURIComponent(addr);
  const url =
    Platform.OS === "ios" ? `maps:?daddr=${encoded}` : `geo:0,0?q=${encoded}`;
  await Linking.openURL(url);
}
