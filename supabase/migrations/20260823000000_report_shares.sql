-- HTML report (Phase 2): hosted client viewer + email-2FA.
--
-- A client receives the report email, taps "View report online", proves control
-- of an authorized email via a 6-digit code (Resend OTP), and then reads the
-- interactive HTML report on the web. These four tables back that flow. All are
-- SERVICE-ROLE ONLY: RLS enabled with NO policies + privileges revoked from
-- anon/authenticated, so only the Edge Functions (service role, bypasses RLS)
-- ever touch them. Nothing here is reachable from the app's anon/user client.
--
--   report_shares   — one active share per inspection; the unguessable
--                     share_token is the public link id. authorized_emails is
--                     the report-channel list (lowercased) frozen at send time.
--   report_otp_codes— hashed 6-digit codes, short-lived, attempt-counted.
--   report_sessions — opaque post-OTP session tokens (no JWT/secret to manage);
--                     revocable, short-lived; the viewer presents one to read
--                     the model.
--   report_views    — audit + engagement (feeds "unopened → nudge" later).

-- ── report_shares ────────────────────────────────────────────────────────────
-- One row per inspection (unique inspection_sk) — re-sending refreshes model_path
-- + authorized_emails on the SAME share_token, so a link already in a client's
-- inbox keeps working and always shows the latest generated report.
CREATE TABLE IF NOT EXISTS public.report_shares (
  share_token         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_sk       TEXT NOT NULL UNIQUE
                        REFERENCES public.inspections (inspection_sk) ON DELETE CASCADE,
  org_sk              UUID,
  model_path          TEXT NOT NULL,              -- model.json snapshot to render
  report_generated_at TIMESTAMPTZ,                -- generated_at of that report
  property_label      TEXT,                       -- denormalized address for the OTP email
  authorized_emails   TEXT[] NOT NULL DEFAULT '{}', -- lowercased report-channel addresses
  created_by          UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,                -- null = no hard expiry
  revoked_at          TIMESTAMPTZ                 -- set to kill a link immediately
);

ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_shares FROM anon, authenticated;
GRANT ALL ON public.report_shares TO service_role;

-- ── report_otp_codes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token  UUID NOT NULL REFERENCES public.report_shares (share_token) ON DELETE CASCADE,
  email        TEXT NOT NULL,          -- lowercased at write
  code_hash    TEXT NOT NULL,          -- SHA-256 hex of the 6-digit code (never store the code)
  expires_at   TIMESTAMPTZ NOT NULL,   -- ~10 minutes out
  attempts     INT NOT NULL DEFAULT 0, -- wrong-code guesses against this row
  consumed_at  TIMESTAMPTZ,            -- set once redeemed; can't be reused
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_otp_codes_lookup_idx
  ON public.report_otp_codes (share_token, email, created_at DESC);

ALTER TABLE public.report_otp_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_otp_codes FROM anon, authenticated;
GRANT ALL ON public.report_otp_codes TO service_role;

-- ── report_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_sessions (
  session_token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token   UUID NOT NULL REFERENCES public.report_shares (share_token) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,  -- ~60 minutes out
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS report_sessions_share_idx
  ON public.report_sessions (share_token);

ALTER TABLE public.report_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_sessions FROM anon, authenticated;
GRANT ALL ON public.report_sessions TO service_role;

-- ── report_views ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token UUID NOT NULL REFERENCES public.report_shares (share_token) ON DELETE CASCADE,
  email       TEXT,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS report_views_share_idx
  ON public.report_views (share_token, viewed_at DESC);

ALTER TABLE public.report_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_views FROM anon, authenticated;
GRANT ALL ON public.report_views TO service_role;
