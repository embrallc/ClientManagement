# HTML Report — Implementation Plan

_Companion mobile/tablet-friendly HTML report generated alongside the PDF. "Double
whammy": **PDF = the formal document**, **HTML = the experience** (responsive,
interactive, securely shareable). Written 2026-08-21. This file is the source of
truth to resume from after compaction._

---

## 0. Locked design decisions (owner, 2026-08-21)

These three calls shape everything below — treat as fixed:

1. **Collapsible sections map to the walkthrough's `static` + `repeatable` sections.**
   Each walkthrough section is a collapsible panel. A `static` section = one panel;
   a `repeatable` section = one panel **per instance** (e.g. "Roof", "Basement"),
   optionally grouped under the section title ("Areas").

2. **The HTML report is built from the WALKTHROUGH DATA, not the PDF Report-Layout.**
   The owner can drop arbitrary shapes / free text / decorations onto the **PDF**
   Report-Layout that have nothing to do with the captured data — those are
   **print-only** and the HTML report **ignores them entirely** (it never reads
   `form_templates`). Instead Zanbi ships a **standard HTML shell** (same structure
   for everyone); only the **data inside the sections differs per org**, driven by
   their walkthrough schema + answers. Zanbi owns the "static decisions" (shell,
   styling, section behavior); the owner does **not** design the HTML.

3. **Every HTML report has a standard HEADER built from the INSPECTION meta, not
   walkthrough data and not the PDF header.** Header = client / property / inspector
   / org / date, read from the `inspections` row + inspector profile + org. Rationale:
   PDF header info is **not** part of the walkthrough form (Zanbi generates the PDF
   header as a starter default, and the owner may turn it off or trim it) — so we
   never try to read it back from the PDF. The HTML header is always complete and
   clean regardless of the PDF's header choices.

**Consequence:** the HTML renderer depends only on `inspections` + `users`/`organizations`
+ `inspection_forms.schema_snapshot` + `inspection_forms.answers`. It is fully
**decoupled** from the PDF band layout (`form_templates`). Simpler, and no parity
coupling to the print template.

---

## 1. Grounding — how the pipeline works today (verified in code)

**Renderer:** `report-worker/` on Railway (Root Directory = `report-worker`, node:22-slim).
Deps: `pdf-lib` + `sharp` only — **no Chromium**. The PDF is **coordinate-drawn**
from the Report-Layout `schema.bands` (absolute x/y). ⇒ HTML is a **separate
renderer** but a cheap one (string templating, **no new deps**).

**Key files:**
- [report-worker/index.js](../report-worker/index.js) — Express server. Two entry points:
  - `POST /api/generate-report` — user JWT; validates a `report_jobs` row; marks
    `processing`; **202 immediately**; renders **detached** (`generateInBackground`);
    uploads PDF; signs URL; `recordReport`; sets job `completed` w/ `report_url`.
  - `POST /api/render-internal` — **service-role** bearer; **synchronous**; for the
    auto-send-on-complete EF path. Renders, uploads, `recordReport`, returns
    `storagePath` for the caller to sign + email.
- [report-worker/lib/render.js](../report-worker/lib/render.js) — `renderInspectionReport({ inspectionSk, userId, orgSk, tzOffsetMin }) → { bytes, pageCount, skippedPhotos, usedDraft, autoBuilt }`.
  **Fetches everything we need** (see below), builds `fieldIndex`/`staticInstances`,
  embeds photos (sharp downscale + EXIF rotate, burned-markup copy when present),
  lays out bands, draws PDF. Contains the value-formatters we will reuse.
- [report-worker/lib/jobs.js](../report-worker/lib/jobs.js) — `buildStoragePath`,
  `uploadReport`, `signReport` (createSignedUrl, TTL default 7d via `SIGNED_URL_TTL`),
  `recordReport` (→ `inspection_reports`), `logToCloud`. Bucket `inspection-reports`
  (env `REPORT_BUCKET`).
- [report-worker/lib/shared/walkthroughSchema.js](../report-worker/lib/shared/walkthroughSchema.js)
  — **the contract** (vendored copy of repo `/shared`). `SECTION_KINDS`,
  `FIELD_TYPES`, `SEVERITY_LEVELS`, shapes. ⚠️ **Vendoring rule:** the worker's
  Docker context is `report-worker/` only, so `report-worker/lib/shared/*` must be
  kept in sync with the repo root `/shared/*`.

**Data `render.js` already fetches (reuse for the model — no extra queries):**
- `inspection` = `inspections.*` (client name, address parts, city/state/zip, phone,
  email, `scheduled_at`, org, user).
- inspector name = `users.fname`/`lname`; org name = `organizations.org_name`.
- `wtSchema` = `inspection_forms.schema_snapshot` (frozen template snapshot).
- `answers` = `inspection_forms.answers`.
- photo refs (from answers): `{ id, cloudUri, burnedCloudUri?, note }`. Bucket
  `inspection-images` (private).

**Walkthrough contract (from walkthroughSchema.js):**
- Template: `{ version, sections: [ { id, kind: "static"|"repeatable", title, addLabel?, fields: [ { id, type, label, required?, config? } ] } ] }`
- Answers: `{ sections: { [sectionId]: { instances: [ { instanceId, fields: { [fieldId]: value } } ] } } }`
  (static ⇒ exactly one instance; repeatable ⇒ 0..N).
- `FIELD_TYPES`: `heading` (display-only, no answer), `text` (string; `config.variant`
  = line|box|multiline), `toggle` (bool → Yes/No), `radio` (option id), `dropdown`
  (option id), `checkbox` (\[option id]), `photo` (\[PhotoRef]), `severity` (severity
  key), `measurement` (numeric string + `config.unit`), `date` (ISO `YYYY-MM-DD`).
- `SEVERITY_LEVELS` = ok #16A34A / low #CA8A04 / medium #EA580C / critical #DC2626
  (each has `key,label,color,bg`).
- PhotoRef: `{ id, localUri, cloudUri, note, markup }` (+ `burnedCloudUri` when markup
  was flattened on-device).

**Delivery / recipients today:**
- Private buckets, **time-limited signed URLs** (never public).
- `inspection_reports` audit row per report.
- `resend-report` EF emails recipients from `channelRecipients(report_recipients, email, "report")`
  ([utils/recipients.js](../utils/recipients.js) mirrors it client-side). **The
  report channel already defines exactly who is authorized to receive the report** →
  this is the authorization list for the HTML report's email-2FA.

---

## 2. Architecture

**One semantic model → two renderers → frozen at generation.**

```
inspections + users/org + inspection_forms(schema_snapshot, answers)
        │
        ├── (existing) band layout ──► pdf-lib ──► report.pdf         (the document)
        └── buildReportModel() ──► ReportModel JSON ──► renderReportHtml() ──► HTML  (the experience)
```

- **`buildReportModel(data)`** — pure function, no I/O. Turns the already-fetched data
  into a normalized `ReportModel` (§3). Reuses the **same value-formatters** as the
  PDF (extract into `shared/reportFormat.js`) so HTML + PDF never disagree on a value.
- **Snapshot, not live.** Store `report.model.json` next to `report.pdf` **at
  generation time** → HTML always matches the delivered PDF and stays a legally
  consistent record. Regeneration = a new versioned pair. (A future "resolution
  tracker" — seller fixed item 7 — can layer live status on top without mutating the
  frozen snapshot.)
- **`renderReportHtml(model, opts)`** — pure `model → HTML string`. Inline CSS/JS,
  responsive, branded, **no external deps** (CSP-safe for hosting). A plain ES module
  so the **same template runs server-side (worker) and client-side (hosted SPA)** —
  one template, two hosts.
- **Photos:** `report.model.json` stores photo **storage paths** (not signed URLs,
  which expire). Whichever surface serves the model **signs them fresh per request**
  (short TTL). For offline/email, the worker can instead inline them as data-URIs via
  its existing `sharp` path.

**Two audiences, two surfaces (same model + same template):**
- **In-app (inspector):** already authenticated → no OTP. WebView renders the HTML.
- **Hosted (client):** a public URL → gated by **email-2FA** (§5).

---

## 3. `ReportModel` JSON (the contract between builder and renderers)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-08-21T18:00:00Z",

  // HEADER — from inspection meta, NEVER walkthrough/PDF (decision #3)
  "meta": {
    "client":   { "name": "Bill Thompson", "phone": "…", "email": "…" },
    "property": { "addressStreet": "1 Cardinal", "cityStateZip": "Fenton, MO 63026",
                  "addressFull": "1 Cardinal, Fenton, MO 63026" },
    "inspection": { "scheduledAt": "Aug 1, 2026 5:09 PM", "scheduledDate": "Aug 1, 2026" },
    "inspector":  { "name": "Pat Callahan" },
    "org":        { "name": "Embra LLC", "logoUrl": null }   // logoUrl signed at serve time if we add org logos
  },

  // Derived from walkthrough answers
  "summary": {
    "severityCounts": { "critical": 1, "medium": 2, "low": 0, "ok": 4 }
  },

  // Collapsible sections (decision #1) — from schema_snapshot + answers, NOT PDF (decision #2)
  "sections": [
    {
      "id": "sec_summary", "title": "Inspection Summary", "kind": "static",
      "instances": [
        {
          "instanceId": "…",
          "title": null,                       // static ⇒ no per-instance title
          "fields": [
            { "id": "f_inspector", "type": "text",   "label": "Inspector name", "display": "text",    "value": "Pat Callahan" },
            { "id": "f_present",   "type": "toggle", "label": "Homeowner present?", "display": "boolean", "value": "Yes" },
            { "id": "f_overview",  "type": "text",   "label": "Overview", "display": "multiline", "value": "…" }
          ],
          "photos": []
        }
      ]
    },
    {
      "id": "sec_area", "title": "Area", "kind": "repeatable",
      "instances": [
        {
          "instanceId": "…",
          "title": "Roof",                     // repeatable ⇒ derived from first text field (fallback "Area 1")
          "fields": [
            { "id": "f_area_name", "type": "text",     "label": "Area / room",       "display": "text",   "value": "Roof" },
            { "id": "f_condition", "type": "radio",    "label": "Overall condition:","display": "choice", "value": "Fair" },
            { "id": "f_desc",      "type": "text",     "label": "Description",        "display": "multiline", "value": "…" },
            { "id": "f_severity",  "type": "severity", "label": "Severity", "display": "severity",
              "value": "Critical", "severity": { "key": "critical", "label": "Critical", "color": "#DC2626", "bg": "#FEE2E2" } }
          ],
          "photos": [
            { "id": "…", "path": "org/user/detail/ts.jpg", "caption": "cracked shingle", "hasMarkup": true }
          ]
        }
      ]
    }
  ]
}
```

**Build rules (`buildReportModel`):**
- Iterate `schema_snapshot.sections` in order → for each, pull its instances from
  `answers.sections[sectionId].instances`.
- For each field in `section.fields`, resolve the stored value from
  `instance.fields[field.id]` and **format via the shared formatters** (radio/dropdown
  → option label; checkbox → joined labels; toggle → Yes/No; measurement → `value unit`;
  date → "Mon D, YYYY"; severity → level label + color; text → verbatim).
- `heading` fields → `display:"heading"` (no value; render as a subheader).
- `photo` fields → collected into the instance's `photos[]` (path = `burnedCloudUri ?? cloudUri`,
  caption = `note`, `hasMarkup = !!burnedCloudUri`). The photo field itself does not
  emit a `value` row.
- Repeatable `instance.title` = the value of the **first `text` field** in the section
  (nice collapsible label like "Roof"); fallback `"{sectionTitle} {n}"`.
- `summary.severityCounts` = tally of every `severity` field across all instances by key.
- Skip empty instances / empty fields cleanly (don't render blank rows). Keep an
  instance if it has any answered field or any photo.

---

## 4. HTML report structure (the standard Zanbi shell)

Mobile-first, single column on phone, comfortable max-width on tablet/desktop. Brand:
indigo accent (`#6366F1`/`#4C46D6`, matches the app + store screenshots), severity
color-coding from `SEVERITY_LEVELS`. All inline; no CDN.

```
┌ Sticky top bar: org name/logo · "Inspection Report" · property address (truncates)
├ HEADER CARD (meta): Client │ Property │ Inspector │ Date        (2-col → 1-col on phone)
├ SEVERITY SUMMARY: chips  [Critical 1] [Medium 2] [Low 0] [OK 4]  (tap → filter findings)
│
├ SECTION (static): "Inspection Summary"                 ▼ collapsible <details>
│     Inspector name: Pat Callahan
│     Homeowner present?: Yes
│     Overview: … (multiline block)
│
├ SECTION GROUP (repeatable): "Areas"
│     ├ Roof            [Critical]                        ▼ collapsible
│     │     Overall condition: Fair
│     │     Description: …
│     │     Severity: ● Critical
│     │     [photo] [photo] [photo]   → lightbox on tap
│     └ Basement       [OK]                               ▼ collapsible
│           …
│
└ FOOTER: generated "Aug 21, 2026" · inspector/org contact ·
          "Digital copy — the PDF is the official report."
```

Interactions (vanilla JS, progressive-enhanced; readable with JS off via `<details>`):
- Collapsible panels via `<details>/<summary>` (severity chip in the summary line).
- Severity summary chips filter/scroll to matching findings.
- Photo **lightbox** (tap to enlarge, swipe, pinch-zoom) — self-contained JS.
- Optional per-section "expand all / collapse all".
- Accessible (semantic headings, `<details>`, alt text, focus states) — a real edge
  over PDFs, which are poor for screen readers.

---

## 5. Security — email-2FA for the hosted report (owner's idea, fleshed out)

A hosted report URL's only real risk is "anyone with the link reads PII." Bind access
to the **report-channel emails** we already compute. **Two layers:**

**Layer 1 — signed share link.** A `report_shares` row keyed by an unguessable
`share_token`. The link (`https://report.getzanbi.com/r/<share_token>`) alone reveals
nothing.

**Layer 2 — email OTP (the 2FA).** To view: enter email → if it's in the share's
`authorized_emails` we email a 6-digit code (Resend) → enter code → we mint a
short-lived **session JWT** bound to `{share_token, email}` → the viewer fetches the
model. Email not authorized → a **uniform** "if authorized, you'll get a code" (never
leak who's allowed).

**Tables (migration; RLS = service-role only, no anon/authenticated):**
- `report_shares` — `share_token uuid pk default gen_random_uuid()`, `inspection_sk`,
  `org_sk`, `model_path text`, `authorized_emails text[]` (lowercased report channel
  at share time), `created_by uuid`, `created_at`, `expires_at`, `revoked_at`.
- `report_otp_codes` — `share_token`, `email citext`, `code_hash text`, `expires_at`
  (~10 min), `attempts int default 0`, `created_at`. (Hash the code; attempt- +
  rate-limited.)
- `report_views` — `share_token`, `email`, `viewed_at`, `ip`, `user_agent`. Feeds
  engagement analytics + comms automation (unopened → nudge).

**Edge Functions (`verify_jwt=false`; they do their own auth):**
- `report-otp-request` `{ shareToken, email }` → look up share; if `email ∈ authorized_emails`,
  gen code, store hash + expiry, `sendEmail` via Resend (`buildOtpEmail`). **Always**
  return `{ ok:true }` (uniform). Rate-limit per `shareToken`+`email`+IP.
- `report-otp-verify` `{ shareToken, email, code }` → verify hash/expiry/attempts
  (constant-time); on success write `report_views`, mint session JWT (HS256, secret in
  EF env; claims `{ shareToken, email, exp:+30–60min }`); return `{ token }`.
- `report-model` `{ shareToken }` + `Authorization: Bearer <sessionJWT>` → validate JWT
  (matches shareToken, not expired, share not revoked/expired); load `model_path` from
  the private bucket; **sign each photo path fresh** (short TTL); return `{ model }`.
- Reuse `_shared/email.ts` (`sendEmail`, add `buildOtpEmail`) + `channelRecipients`.

**Share creation:** when a report is generated/auto-sent, upsert a `report_shares` row
(`authorized_emails` = the report channel). Do this in the worker (has org/user) or in
`resend-report`. `resend-report` also adds a **"View report online"** link to the email.

**Inspector view:** org users skip OTP entirely — the app is already authenticated
(Phase 1 in-app path), separate from the client OTP flow.

---

## 6. Phased implementation

Each phase is independently shippable and low-risk. Build in order.

### Phase 0 — Semantic model (worker-only, invisible) ⟵ START HERE
**Goal:** every generated report also produces + stores a `ReportModel` JSON. Nothing
user-facing.
- **New** `report-worker/lib/shared/reportFormat.js` — extract from `render.js`:
  `formatFieldValue`, `formatDateOnly`, `severityColor`/severity lookup, `addressStreet/CityStateZip/Full`,
  `formatDate`, `camelToSnake`. Keep `render.js` importing them (no behavior change).
  **Mirror to repo `/shared/` per the vendoring rule.**
- **New** `report-worker/lib/shared/reportModel.js` — `buildReportModel({ inspection, inspectorName, orgName, wtSchema, answers, tzOffsetMin }) → ReportModel`. Pure.
- **Edit** `report-worker/lib/render.js` — build the model from the already-fetched
  `inspection`/profile/org/`wtSchema`/`answers` and **return it**: `{ bytes, …, model }`.
  Wrap in try/catch → **model failure must never fail the PDF** (return `model:null`, log).
- **Edit** `report-worker/lib/jobs.js` — `buildModelPath(pdfPath)` (sibling
  `…/{ts}.model.json`), `uploadModel(path, json)`; record `model_path` on
  `inspection_reports`.
- **Edit** `report-worker/index.js` — in both entry points, after render, upload the
  model JSON (best-effort) and pass `model_path` to `recordReport`.
- **DB migration** — `inspection_reports add column model_path text`.
- **Deliverable / test:** generate a report on staging → confirm `…model.json` lands
  in the bucket and validates against §3. Throwaway: render a local HTML from a real
  model to eyeball the mobile report before Phase 1 UI.

### Phase 1 — In-app HTML view (inspector-facing, no auth infra)
**Goal:** inspectors get the responsive report in-app.
- **New** `shared/renderReportHtml.js` (repo root, so app + worker + SPA can share) —
  `renderReportHtml(model, { images: "signed" | "datauri" }) → string`. The §4 shell.
- **Serving:** a Supabase EF `report-view` (user JWT; authorizes caller owns the
  inspection) → loads latest `model.json`, signs photo paths, returns **self-contained
  HTML** (or `{ model }` + signed photo URLs). Recommend: EF returns HTML → app just
  loads it in a WebView.
- **Edit** `app/reportviewer.jsx` — add an **HTML view** (WebView) as the default nice
  view; keep PDF as **download / share / print**.
- **Deliverable / test:** open a completed inspection → HTML view renders (header,
  collapsibles by static/repeatable, severity summary, photo lightbox).

### Phase 2 — Hosted client viewer + email-2FA (the double-whammy)
**Goal:** clients get a secure, mobile-first hosted report.
- **DB migration** — `report_shares`, `report_otp_codes`, `report_views` (+ service-role RLS).
- **EFs** — `report-otp-request`, `report-otp-verify`, `report-model` + `_shared`
  OTP/JWT/`buildOtpEmail` helpers. Register in `supabase/config.toml`
  (`verify_jwt=false`).
- **Share creation** — worker (or `resend-report`) upserts `report_shares` on generate/send.
- **Edit** `resend-report` EF — add "View report online" link (the share URL).
- **New** report-viewer SPA — a Cloudflare Pages project (e.g. `report-web/`) at
  `report.getzanbi.com`; route `/r/:shareToken` → email → OTP → renders via the shared
  `renderReportHtml` (client-side) using the model from `report-model`.
- **Deliverable / test:** send a report to a test email → open link → OTP → renders;
  an unauthorized email gets the uniform response (no leak); revocation/expiry work.

### Phase 3 — Engagement + transactional
- `report_views` analytics → **comms automation** ("unopened 48h → nudge").
- Inline **Pay invoice** (reuse the Stripe Connect checkout link), **Ask a question**
  (routes to inspector), **e-sign acknowledgment**, severity **triage/filter** view,
  per-finding **deep links**, language toggle.

### Phase 4 — Speculative
- Repair-estimate / contractor hooks off Critical findings; "resolution tracker" live
  layer over the frozen snapshot.

---

## 7. Cross-cutting

- **Reliability:** model + HTML generation always `try/catch` — a failure logs and is
  skipped; the **PDF path is never affected**.
- **No new worker deps** (HTML = string templating; photos via existing `sharp` for
  data-URIs, or fresh signed URLs).
- **Cost:** free-tier friendly — Cloudflare Pages (static SPA), Supabase EFs, Resend
  (OTP). Aligns with the low-cost goal.
- **Vendoring:** anything under `report-worker/lib/shared/` must mirror repo `/shared/`.
  Prefer putting shared logic in repo `/shared/` and vendoring a copy.
- **Parity (intentional):** HTML shows **all answered fields grouped by section** +
  a Zanbi header; it does **not** mirror PDF-only shapes/text/header choices. This is
  by design (decisions #2/#3), not a bug.
- **Deploy:** worker deploys **manually** on Railway after `report-worker/**` changes;
  EFs auto-deploy to staging on merge to `main`, prod on a `v*` tag (gated); Cloudflare
  Pages via its own deploy.

---

## 8. Open decisions (resolve as we hit them)

1. **Hosted domain** — `report.getzanbi.com` (needs a Cloudflare DNS/Pages project).
   Confirm subdomain + that we host publicly at all (vs in-app-only). _Owner leaning:
   hosted + 2FA._
2. **In-app serving** — EF returns full self-contained HTML (simplest for WebView) vs
   returns `{ model }` and the app renders (avoids shipping the template twice).
   _Lean: EF returns HTML for Phase 1._
3. **Store `report.html` at generate time** vs render on demand from `model.json`.
   _Lean: store only `model.json` (one source); render HTML on demand._
4. **OTP params** — 6-digit / 10-min code, 30–60-min session, N attempts, rate limits.
5. **Repeatable instance title** heuristic — first `text` field value, fallback
   `"{title} {n}"`. Confirm.
6. **Severity summary** counts every `severity`-type field. Confirm (vs a designated one).
7. **Org logo** in the HTML header — do we have an org logo asset to show? (PDF uses
   `form-assets`.) Optional for v1.

---

## 9. Quick file index (for resume)

| Area | Path |
|---|---|
| Worker server + entry points | `report-worker/index.js` |
| PDF renderer + formatters (to extract) | `report-worker/lib/render.js` |
| Storage/job helpers | `report-worker/lib/jobs.js` |
| Walkthrough contract (vendored) | `report-worker/lib/shared/walkthroughSchema.js` |
| Repo shared contract (mirror target) | `/shared/walkthroughSchema.js` |
| Report-channel recipients (client mirror) | `utils/recipients.js` |
| Report email send | `supabase/functions/resend-invoice/…` pattern; `resend-report` |
| Client report viewer (app) | `app/reportviewer.jsx` |
| **New (Phase 0)** | `report-worker/lib/shared/reportFormat.js`, `report-worker/lib/shared/reportModel.js` |
| **New (Phase 1)** | `shared/renderReportHtml.js`, EF `report-view`, `app/reportviewer.jsx` edit |
| **New (Phase 2)** | migration (report_shares/otp/views), EFs `report-otp-request`/`report-otp-verify`/`report-model`, `report-web/` SPA, `resend-report` edit |

---

_First action when we resume: **Phase 0** — extract `reportFormat.js`, add
`reportModel.js`, have `render.js` return the model + `index.js`/`jobs.js` store
`report.model.json`, add the `inspection_reports.model_path` migration. Worker-only,
reversible, unblocks everything._
