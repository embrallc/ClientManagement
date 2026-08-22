-- HTML report (Phase 0): every generated report now also produces a semantic
-- ReportModel JSON, stored beside the PDF in the private `inspection-reports`
-- bucket as a sibling `<ts>.model.json`. This column records that object's
-- storage path so a later surface (in-app HTML view, hosted client viewer) can
-- load the model and re-render the responsive report without re-generating.
--
-- Nullable on purpose: legacy rows, and any report whose model build was skipped
-- (best-effort — a model failure never blocks the PDF), simply have no model.
--
-- No new grants/RLS: inspection_reports is service-role only (written by the
-- report-worker); the app never reads this table directly.

alter table public.inspection_reports
  add column if not exists model_path text;
