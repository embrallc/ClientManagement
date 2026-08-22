// ─────────────────────────────────────────────────────────────────────────────
// Report value formatters — the single source of truth for turning stored
// walkthrough answers + inspection fields into human-readable strings. Shared by
// the PDF renderer (report-worker) and the HTML report model builder so the two
// surfaces can never disagree on how a value reads.
//
// Pure + dependency-free (only SEVERITY_LEVELS from the walkthrough contract).
// Extracted verbatim from the PDF renderer's inline helpers.
//
// ⚠️ Vendoring: report-worker/lib/shared/reportFormat.js is a copy of this file
// (the worker's Docker build context is report-worker/ only). Keep them in sync.
// ─────────────────────────────────────────────────────────────────────────────

import { SEVERITY_LEVELS } from "./walkthroughSchema.js";

// camelCase → snake_case (binding key → inspections column name).
export function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format an ISO timestamp as locale-free "Mon D, YYYY" (optionally with time),
// shifted by the caller's timezone offset (minutes) so dates read in local time.
export function formatDate(iso, tzOffsetMin = 0, withTime = false) {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + tzOffsetMin * 60000);
  let out = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (withTime) {
    let h = d.getUTCHours();
    const m = d.getUTCMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    out += ` ${h}:${m} ${ampm}`;
  }
  return out;
}

// A walkthrough date field stores an ISO "YYYY-MM-DD" string; print it in a
// readable, locale-free form without any timezone shift.
export function formatDateOnly(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return s ?? "";
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return s;
  return `${MONTHS[mi]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// ── Address assembly (empty parts skipped) ──────────────────────────────────
function inspStr(inspection, col) {
  const v = inspection?.[col];
  return v == null ? "" : String(v).trim();
}
export function addressStreet(inspection) {
  return [inspStr(inspection, "address_line1"), inspStr(inspection, "address_line2")]
    .filter(Boolean).join(", ");
}
export function cityStateZip(inspection) {
  const cityState = [inspStr(inspection, "city"), inspStr(inspection, "state")]
    .filter(Boolean).join(", ");
  return [cityState, inspStr(inspection, "zip_code")].filter(Boolean).join(" ");
}
export function addressFull(inspection) {
  return [addressStreet(inspection), cityStateZip(inspection)].filter(Boolean).join(", ");
}

// ── Severity ────────────────────────────────────────────────────────────────
// Hex color for a severity value (matches key or label; fuzzy fallback for
// legacy free-text condition values). Returns null when nothing matches.
export function severityColor(value) {
  const v = (value ?? "").toLowerCase();
  for (const lvl of SEVERITY_LEVELS) {
    if (lvl.label.toLowerCase() === v || lvl.key.toLowerCase() === v) {
      return lvl.color;
    }
  }
  if (/(low|good|minor|ok)/.test(v)) return "#16A34A";
  if (/(med|moderate|fair)/.test(v)) return "#D97706";
  if (/(high|severe|critical|major|poor)/.test(v)) return "#DC2626";
  return null;
}

// Full severity level ({ key, label, color, bg }) for a stored severity value
// (a severity key per the contract; label match as a legacy fallback).
export function severityLevelForKey(value) {
  if (value == null) return null;
  const v = String(value).toLowerCase();
  return (
    SEVERITY_LEVELS.find((l) => l.key.toLowerCase() === v) ??
    SEVERITY_LEVELS.find((l) => l.label.toLowerCase() === v) ??
    null
  );
}

// ── Field value → display string ─────────────────────────────────────────────
// meta = { type, options?, unit? } (a resolved field descriptor). Mirrors the
// walkthrough field types.
export function formatFieldValue(meta, value) {
  if (value == null) return "";
  switch (meta.type) {
    case "toggle":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "radio":
    case "dropdown":
      return (meta.options ?? []).find((o) => o.id === value)?.label ?? "";
    case "checkbox":
      if (!Array.isArray(value)) return "";
      return value
        .map((id) => (meta.options ?? []).find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(", ");
    case "severity":
      return SEVERITY_LEVELS.find((l) => l.key === value)?.label ?? String(value);
    case "measurement": {
      const v = typeof value === "string" ? value.trim() : String(value);
      if (!v) return "";
      return meta.unit ? `${v} ${meta.unit}` : v;
    }
    case "date":
      return typeof value === "string" ? formatDateOnly(value) : "";
    default:
      return typeof value === "string" ? value : String(value);
  }
}
