// Shared crypto helpers for the hosted report viewer's email-2FA (OTP). Uses the
// Web Crypto API on globalThis (available in the Deno edge runtime) — no deps.

// Cryptographically-random numeric code, zero-padded to `len` digits. Modulo bias
// over 2^32 for a 6-digit space is negligible for a short-lived, attempt-limited
// OTP.
export function generateCode(len = 6): string {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  const n = buf[0] % 10 ** len;
  return n.toString().padStart(len, "0");
}

// SHA-256 hex of `pepper + code`. We never store the plaintext code; the optional
// pepper (REPORT_OTP_PEPPER env) means a bare DB read can't be brute-forced offline.
export async function hashCode(code: string, pepper = ""): Promise<string> {
  const data = new TextEncoder().encode(`${pepper}${code}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Length-independent constant-time compare of two equal-length hex strings.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function normalizeEmail(e: unknown): string {
  return typeof e === "string" ? e.trim().toLowerCase() : "";
}
