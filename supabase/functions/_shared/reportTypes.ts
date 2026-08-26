// Report Types decision — the single source of truth for "which report artifacts
// does the CLIENT get for this inspection". Used by the auto-send path
// (send-report-to-client) and the manual "Email report" path (resend-report) so
// both branch identically.
//
//   makePdf    = org.report_pdf_enabled    && (insp.report_pdf    ?? org.report_pdf_default)
//   makeOnline = org.report_online_enabled && (insp.report_online ?? org.report_online_default)
//
// The `?? default` fallback covers legacy inspection rows created before the
// per-inspection columns existed (they read NULL → use the org default). A missing
// org row (shouldn't happen) falls back to fully-enabled + default-on so an org
// that somehow predates these columns behaves exactly as before (both types on).

export interface OrgReportFlags {
  report_pdf_enabled?: boolean | null;
  report_online_enabled?: boolean | null;
  report_pdf_default?: boolean | null;
  report_online_default?: boolean | null;
}

export interface InspectionReportFlags {
  report_pdf?: boolean | null;
  report_online?: boolean | null;
}

export function computeReportTypes(
  insp: InspectionReportFlags | null | undefined,
  org: OrgReportFlags | null | undefined,
): { makePdf: boolean; makeOnline: boolean } {
  const pdfEnabled = org?.report_pdf_enabled ?? true;
  const onlineEnabled = org?.report_online_enabled ?? true;
  const pdfDefault = org?.report_pdf_default ?? true;
  const onlineDefault = org?.report_online_default ?? true;

  const inspPdf = insp?.report_pdf ?? pdfDefault;
  const inspOnline = insp?.report_online ?? onlineDefault;

  return {
    makePdf: !!pdfEnabled && !!inspPdf,
    makeOnline: !!onlineEnabled && !!inspOnline,
  };
}
