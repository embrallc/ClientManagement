-- Owner-editable company name (Settings → Profile).
--
-- org_name is already updatable by `authenticated` via the blanket table grant
-- (20260624000000) and is gated to the org's OWNER by the org_update_owner RLS
-- policy (20260616010000_org_timezone.sql, USING/WITH CHECK auth_uid_owns_org).
-- This adds an EXPLICIT column-level UPDATE grant as defense-in-depth, mirroring
-- has_seen_walkthrough_intro (20260717000100): it documents org_name as an
-- intentionally owner-writable column and preserves the write path if the blanket
-- grant is ever tightened. RLS still restricts the actual write to the owner, so
-- admins/members cannot rename the org even though the column privilege is granted
-- to `authenticated` (the role, not the person).

grant update (org_name) on public.organizations to authenticated;
