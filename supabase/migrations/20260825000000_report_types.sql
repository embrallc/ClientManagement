-- Report Types — per-org PDF / interactive-Online capability + per-inspection choice.
--
-- ORG level (organizations):
--   report_pdf_enabled     — this org produces PDF reports at all.
--   report_online_enabled  — this org produces interactive online reports at all.
--   report_pdf_default     — the default state of a NEW inspection's PDF toggle.
--   report_online_default  — the default state of a NEW inspection's Online toggle.
-- All default TRUE so existing orgs keep producing the PDF and START offering the
-- online link on completion (which they didn't before). Owner-editable (RLS
-- org_update_owner gates the write; the explicit column grant is defense-in-depth,
-- mirroring org_name / has_seen_walkthrough_intro).
--
-- INSPECTION level (inspections):
--   report_pdf     — deliver a PDF to the client for THIS inspection.
--   report_online  — deliver the interactive online report to the client.
-- Seeded from the org defaults in Add/Edit, overridable per client. Device-editable
-- synced columns like has_appt_reminder / report_recipients (blanket table grant +
-- ownership RLS already cover them — no extra grant needed). Default TRUE so
-- pre-migration inspections behave exactly as today.
--
-- The report worker + client-send Edge Functions read these server-side (they
-- already load the inspection + org rows) and compute:
--   makePdf    = org.report_pdf_enabled    AND coalesce(insp.report_pdf,    org.report_pdf_default)
--   makeOnline = org.report_online_enabled AND coalesce(insp.report_online, org.report_online_default)

alter table public.organizations
  add column if not exists report_pdf_enabled     boolean not null default true;
alter table public.organizations
  add column if not exists report_online_enabled  boolean not null default true;
alter table public.organizations
  add column if not exists report_pdf_default      boolean not null default true;
alter table public.organizations
  add column if not exists report_online_default   boolean not null default true;

grant update (report_pdf_enabled, report_online_enabled, report_pdf_default, report_online_default)
  on public.organizations to authenticated;

alter table public.inspections
  add column if not exists report_pdf    boolean not null default true;
alter table public.inspections
  add column if not exists report_online boolean not null default true;

-- Online-only inspections have no PDF, so the inspection_reports audit row must be
-- able to record a model without a PDF storage_path. Make it nullable (model_path
-- already is). A row now carries at least one of storage_path / model_path.
alter table public.inspection_reports
  alter column storage_path drop not null;
