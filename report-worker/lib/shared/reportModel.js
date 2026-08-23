// VENDORED COPY — keep in sync with /shared/reportModel.js.
// The worker deploys with build context = report-worker/ only, so the repo's
// /shared modules aren't in the Docker image; they're mirrored here.
// ─────────────────────────────────────────────────────────────────────────────
// buildReportModel — turns an inspection's already-fetched data (inspection row
// + inspector/org + frozen walkthrough schema snapshot + answers) into a
// normalized, renderer-agnostic ReportModel JSON.
//
// This is the ONE semantic model behind both report surfaces: the PDF
// (coordinate-drawn, print) and the HTML report (responsive, interactive). It is
// built from the WALKTHROUGH data only — never the PDF band layout — and the
// header comes from inspection meta, not the walkthrough (see
// docs/html-report-plan.md, locked decisions #1–#3).
//
// Pure: no I/O. Photo refs carry storage PATHS (not signed URLs, which expire);
// whichever surface serves the model signs them fresh per request.
// ─────────────────────────────────────────────────────────────────────────────

import {
  formatFieldValue,
  formatDate,
  addressStreet,
  cityStateZip,
  addressFull,
  severityLevelForKey,
} from "./reportFormat.js";

export const REPORT_MODEL_VERSION = 1;

// HTML display kind per walkthrough field type — drives how the renderer lays a
// field out (a boolean pill, a choice value, a multiline block, a severity chip…).
function displayKind(field) {
  switch (field.type) {
    case "toggle":
      return "boolean";
    case "radio":
    case "dropdown":
      return "choice";
    case "checkbox":
      return "choices";
    case "severity":
      return "severity";
    case "measurement":
      return "measurement";
    case "date":
      return "date";
    case "text":
      return field.config?.variant === "multiline" ? "multiline" : "text";
    default:
      return "text";
  }
}

export function buildReportModel({
  inspection,
  inspectorName = "",
  orgName = "",
  orgLogoPath = null,
  wtSchema,
  answers,
  tzOffsetMin = 0,
}) {
  const severityCounts = { critical: 0, medium: 0, low: 0, ok: 0 };
  const sections = [];

  for (const sec of wtSchema?.sections ?? []) {
    const isRepeatable = sec.kind === "repeatable";
    const rawInstances = answers?.sections?.[sec.id]?.instances ?? [];
    const instances = [];

    for (let i = 0; i < rawInstances.length; i++) {
      const raw = rawInstances[i];
      const vals = raw?.fields ?? {};
      const fields = [];
      const photos = [];
      let titleFromText = null;

      for (const field of sec.fields ?? []) {
        // Display-only heading — no stored value.
        if (field.type === "heading") {
          fields.push({
            id: field.id,
            type: "heading",
            label: field.label ?? "",
            display: "heading",
          });
          continue;
        }

        // Photos → collected into the instance's photo strip, not a value row.
        if (field.type === "photo") {
          const arr = vals[field.id];
          if (Array.isArray(arr)) {
            for (const p of arr) {
              if (p && typeof p === "object" && p.id && (p.burnedCloudUri || p.cloudUri)) {
                photos.push({
                  id: p.id,
                  path: p.burnedCloudUri ?? p.cloudUri,
                  caption: typeof p.note === "string" ? p.note : "",
                  hasMarkup: !!p.burnedCloudUri,
                });
              }
            }
          }
          continue;
        }

        const rawValue = vals[field.id];
        const meta = {
          type: field.type,
          options: field.config?.options ?? null,
          unit: field.config?.unit ?? null,
        };
        const value = formatFieldValue(meta, rawValue);
        if (value === "" || value == null) continue; // skip unanswered cleanly

        const out = {
          id: field.id,
          type: field.type,
          label: field.label ?? "",
          display: displayKind(field),
          value,
        };

        if (field.type === "severity") {
          const lvl = severityLevelForKey(rawValue);
          if (lvl) {
            out.severity = { key: lvl.key, label: lvl.label, color: lvl.color, bg: lvl.bg };
            if (severityCounts[lvl.key] != null) severityCounts[lvl.key] += 1;
          }
        }

        // First answered text field → a friendly label for a repeatable panel.
        if (
          isRepeatable &&
          field.type === "text" &&
          titleFromText == null &&
          typeof value === "string" &&
          value.trim()
        ) {
          titleFromText = value.trim();
        }

        fields.push(out);
      }

      // Drop empty instances — only real answers or photos count as content;
      // a lone display-only heading does not keep an instance alive.
      const hasContent =
        fields.some((f) => f.display !== "heading") || photos.length > 0;
      if (!hasContent) continue;

      instances.push({
        instanceId: raw?.instanceId ?? `${sec.id}_${i}`,
        title: isRepeatable
          ? titleFromText ?? `${sec.title || "Item"} ${instances.length + 1}`
          : null,
        fields,
        photos,
      });
    }

    if (instances.length === 0) continue; // drop empty sections

    sections.push({
      id: sec.id,
      title: sec.title ?? "",
      kind: isRepeatable ? "repeatable" : "static",
      addLabel: sec.addLabel ?? null,
      instances,
    });
  }

  return {
    version: REPORT_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    meta: {
      client: {
        name: (inspection?.full_name ?? "").trim(),
        phone: (inspection?.phone ?? "").trim(),
        email: (inspection?.email ?? "").trim(),
      },
      property: {
        addressStreet: addressStreet(inspection),
        cityStateZip: cityStateZip(inspection),
        addressFull: addressFull(inspection),
      },
      inspection: {
        scheduledAt: formatDate(inspection?.scheduled_at ?? null, tzOffsetMin, true),
        scheduledDate: formatDate(inspection?.scheduled_at ?? null, tzOffsetMin, false),
      },
      inspector: { name: inspectorName ?? "" },
      org: { name: orgName ?? "", logoPath: orgLogoPath ?? null },
    },
    summary: { severityCounts },
    sections,
  };
}
