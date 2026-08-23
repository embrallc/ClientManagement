// VENDORED COPY — keep in sync with /shared/renderReportHtml.js.
// Deno import for the report-view Edge Function (pure string templating,
// no deps, runs identically in Node / Deno / the browser).
// ─────────────────────────────────────────────────────────────────────────────
// renderReportHtml — the standard Zanbi HTML report shell.
//
// Pure `ReportModel → HTML string`. No I/O, no deps, no external assets (fonts,
// scripts, images all inline or caller-supplied) so it is CSP-safe for hosting
// and runs identically server-side (report-worker) and client-side (hosted SPA)
// or inside the app's WebView. See docs/html-report-plan.md §4.
//
// The report is the SAME shell for every org (Zanbi owns the design); only the
// data inside the sections differs. Header = inspection meta. Sections =
// walkthrough static/repeatable data. It never reads the PDF band layout.
//
// Exports:
//   renderReportHtml(model, opts)      → full standalone <!doctype html> document
//                                        (for a WebView / hosted page / iframe)
//   renderReportFragment(model, opts)  → <style> + markup + <script> only, no
//                                        doc tags (to embed in an existing page)
//
// opts:
//   photoSrc(photo) → string|null   resolve a photo {id,path,caption,hasMarkup}
//                                   to a displayable URL (signed URL / data URI).
//                                   Missing/null → a labeled placeholder tile.
//   photosPerRow                    owner preference: "auto" (default) | 2 | 3 | 4.
//   title                           document <title> (full-doc mode only).
//
// ⚠️ Vendoring: if the worker ever renders HTML, mirror a copy under
// report-worker/lib/shared/ per the vendoring rule.
// ─────────────────────────────────────────────────────────────────────────────

const SEV_RANK = { ok: 0, low: 1, medium: 2, critical: 3 };

// Default open state. The header opens COLLAPSED (address only; expand for the
// rest); content cards open EXPANDED so the report reads as a document, with
// collapse available to fold sections away. Flip via opts if ever needed.
const HEADER_OPEN_DEFAULT = false;
const PANEL_OPEN_DEFAULT = true;

// ── Escaping ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// Preserve author line breaks in multiline values (after escaping).
function escMultiline(s) {
  return esc(s).replace(/\r?\n/g, "<br>");
}

// ── Severity helpers ────────────────────────────────────────────────────────
function instanceSeverityKeys(instance) {
  const keys = new Set();
  for (const f of instance.fields ?? []) {
    if (f.severity?.key) keys.add(f.severity.key);
  }
  return [...keys];
}
function instanceTopSeverity(instance) {
  let top = null;
  for (const f of instance.fields ?? []) {
    const k = f.severity?.key;
    if (k && (top === null || SEV_RANK[k] > SEV_RANK[top])) top = k;
  }
  return top ? instance.fields.find((f) => f.severity?.key === top).severity : null;
}

// ── Field row ────────────────────────────────────────────────────────────────
function renderField(field) {
  if (field.display === "heading") {
    return `<h3 class="zr-heading">${esc(field.value ?? field.label)}</h3>`;
  }
  const label = `<dt class="zr-label">${esc(field.label)}</dt>`;
  let value;
  switch (field.display) {
    case "boolean": {
      const yes = /^yes$/i.test(field.value);
      value = `<dd class="zr-value"><span class="zr-pill ${yes ? "is-yes" : "is-no"}">${esc(field.value)}</span></dd>`;
      break;
    }
    case "severity": {
      const s = field.severity;
      value = s
        ? `<dd class="zr-value"><span class="zr-chip" style="--chip:${esc(s.color)};--chip-bg:${esc(s.bg)}"><span class="zr-dot" aria-hidden="true"></span>${esc(s.label)}</span></dd>`
        : `<dd class="zr-value">${esc(field.value)}</dd>`;
      break;
    }
    case "multiline":
      value = `<dd class="zr-value zr-multiline">${escMultiline(field.value)}</dd>`;
      break;
    default:
      value = `<dd class="zr-value">${esc(field.value)}</dd>`;
  }
  return label + value;
}

// ── Photos ────────────────────────────────────────────────────────────────────
function renderPhotos(photos, opts) {
  if (!photos?.length) return "";
  const tiles = photos
    .map((p, i) => {
      const src = opts.photoSrc ? opts.photoSrc(p) : null;
      const cap = p.caption ? esc(p.caption) : "";
      const aria = p.caption ? esc(p.caption) : "Inspection photo";
      const media = src
        ? `<img src="${esc(src)}" alt="${aria}" loading="lazy" decoding="async">`
        : `<span class="zr-noimg" aria-hidden="true">◎</span>`;
      // Data attrs feed the lightbox without a second data structure.
      return `<button type="button" class="zr-photo" data-full="${esc(src ?? "")}" data-cap="${cap}" aria-label="${aria}${p.hasMarkup ? ", annotated" : ""} — tap to enlarge">
        ${media}
        ${p.hasMarkup ? `<span class="zr-badge-markup" title="Annotated">✎</span>` : ""}
        ${cap ? `<span class="zr-photo-cap">${cap}</span>` : ""}
      </button>`;
    })
    .join("");
  return `<div class="zr-photos" role="group" aria-label="Photos">${tiles}</div>`;
}

// ── One collapsible card ──────────────────────────────────────────────────────
// The single, uniform unit of the report. Static sections and repeatable
// instances both render as this — the static/repeatable distinction is the
// inspector's form detail and never surfaces to the customer.
function renderPanel({ title, instance, open, opts, id }) {
  const top = instanceTopSeverity(instance);
  const sevKeys = instanceSeverityKeys(instance).join(" ");
  const badge = top
    ? `<span class="zr-chip zr-chip-sm" style="--chip:${esc(top.color)};--chip-bg:${esc(top.bg)}"><span class="zr-dot" aria-hidden="true"></span>${esc(top.label)}</span>`
    : "";
  const fieldsHtml = (instance.fields ?? []).map(renderField).join("");
  return `
    <details class="zr-panel" data-severities="${sevKeys}"${open ? " open" : ""}>
      <summary class="zr-panel-head">
        <h2 class="zr-panel-title" id="${esc(id)}">${esc(title)}</h2>
        ${badge}
        <span class="zr-chev" aria-hidden="true"></span>
      </summary>
      <div class="zr-panel-body">
        ${fieldsHtml ? `<dl class="zr-fields">${fieldsHtml}</dl>` : ""}
        ${renderPhotos(instance.photos, opts)}
      </div>
    </details>`;
}

// Flatten the model into ONE ordered list of cards: each static section → a
// card (its section title); each repeatable instance → a card (its own title).
function renderPanels(model, opts) {
  const out = [];
  for (const sec of model.sections ?? []) {
    const repeatable = sec.kind === "repeatable";
    (sec.instances ?? []).forEach((inst, i) => {
      const title = repeatable
        ? inst.title || `${sec.title || "Item"} ${i + 1}`
        : sec.title;
      out.push(
        renderPanel({
          title,
          instance: inst,
          open: PANEL_OPEN_DEFAULT,
          opts,
          id: `p-${esc(sec.id)}${i ? `-${i}` : ""}`,
        }),
      );
    });
  }
  return out.join("");
}

// ── Header + summary + footer ─────────────────────────────────────────────────
function metaRow(label, value) {
  if (!value) return "";
  return `<div class="zr-meta-row"><span class="zr-meta-label">${esc(label)}</span><span class="zr-meta-value">${esc(value)}</span></div>`;
}

// The header is itself a collapsible card: collapsed shows only identity
// (org · Inspection Report / street / city-state-zip); expanded reveals the
// reference details (client, inspector, date). Built from inspection meta only.
function renderHeaderPanel(model) {
  const m = model.meta;
  const org = m.org?.name || "Inspection Report";
  const addr1 = m.property?.addressStreet || m.property?.addressFull || "Property";
  const addr2 = m.property?.cityStateZip || "";
  const idBlock = `
      <div class="zr-header-id">
        <div class="zr-eyebrow">${esc(org)} · Inspection Report</div>
        <h1 class="zr-address">${esc(addr1)}</h1>
        ${addr2 ? `<div class="zr-address-sub">${esc(addr2)}</div>` : ""}
      </div>`;
  const rows = [
    metaRow("Client", m.client?.name),
    metaRow("Inspector", m.inspector?.name),
    metaRow("Date", m.inspection?.scheduledAt || m.inspection?.scheduledDate),
  ]
    .filter(Boolean)
    .join("");

  // Nothing to reveal → a plain (non-collapsible) header, no dangling chevron.
  if (!rows) {
    return `<header class="zr-header zr-header-flat">${idBlock}</header>`;
  }
  return `
    <details class="zr-panel zr-header"${HEADER_OPEN_DEFAULT ? " open" : ""}>
      <summary class="zr-panel-head zr-header-head">
        ${idBlock}
        <span class="zr-chev zr-header-chev" aria-hidden="true"></span>
      </summary>
      <div class="zr-panel-body zr-header-body">
        <dl class="zr-meta">${rows}</dl>
      </div>
    </details>`;
}

function renderFooter(model) {
  const m = model.meta;
  const gen = model.generatedAt
    ? new Date(model.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
  const contact = [m.org?.name, m.inspector?.name].filter(Boolean).join(" · ");
  return `
    <footer class="zr-footer">
      ${contact ? `<div class="zr-foot-org">${esc(contact)}</div>` : ""}
      ${gen ? `<div class="zr-foot-gen">Generated ${esc(gen)}</div>` : ""}
      <div class="zr-foot-note">This is a digital copy for easy viewing. The PDF is the official report of record.</div>
    </footer>`;
}

// Owner presentation preferences → root CSS variables, applied at RENDER time
// (not baked into the frozen model). A curated, safe set only — the shell and
// design stay Zanbi's; the owner never hand-designs the HTML. Set on the report
// side, never in the walkthrough. Currently:
//   photosPerRow: "auto" (default, responsive) | 2 | 3 | 4
function rootStyleVars(opts = {}) {
  const styles = [];
  const ppr = opts.photosPerRow;
  if (ppr != null && ppr !== "auto") {
    const cols = Math.max(1, Math.min(6, parseInt(ppr, 10) || 0));
    if (cols) styles.push(`--zr-photo-cols:${cols}`, "--zr-photo-min:0px");
  }
  return styles.length ? ` style="${styles.join(";")}"` : "";
}

// ── Body markup ───────────────────────────────────────────────────────────────
function renderBodyMarkup(model, opts) {
  const panels = renderPanels(model, opts);
  return `
  <div class="zanbi-report"${rootStyleVars(opts)}>
    <div class="zr-topbar">
      <span class="zr-topbar-org">${esc(model.meta?.org?.name || "Zanbi")}</span>
      <span class="zr-topbar-label">Inspection Report</span>
    </div>
    <main class="zr-main">
      <div class="zr-panels zr-panels-root">
        ${renderHeaderPanel(model)}
        ${panels || `<p class="zr-empty">This report has no recorded findings yet.</p>`}
      </div>
      ${renderFooter(model)}
    </main>
    <div class="zr-lightbox" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <button type="button" class="zr-lb-close" aria-label="Close photo viewer">✕</button>
      <button type="button" class="zr-lb-prev" aria-label="Previous photo">‹</button>
      <figure class="zr-lb-figure">
        <img class="zr-lb-img" alt="">
        <figcaption class="zr-lb-cap"></figcaption>
      </figure>
      <button type="button" class="zr-lb-next" aria-label="Next photo">›</button>
    </div>
  </div>`;
}

// ── Styles (component CSS; references --zr-* theme tokens) ─────────────────────
function tokenBlock(sel) {
  // Committed light theme (no dark variant) — the report always renders light.
  return `
${sel}{
  --zr-canvas:#f2f4f9; --zr-surface:#ffffff; --zr-surface-2:#f8fafc;
  --zr-ink:#171922; --zr-ink-2:#3f4456; --zr-muted:#6b7180; --zr-faint:#9aa0b0;
  --zr-line:#e7e9f1; --zr-line-2:#f0f2f7;
  --zr-brand:#4c46d6; --zr-brand-2:#6366f1; --zr-brand-ink:#ffffff;
  --zr-shadow:0 1px 2px rgba(20,22,44,.04), 0 8px 24px rgba(20,22,44,.06);
  --zr-shadow-lg:0 12px 48px rgba(15,17,40,.24);
  --zr-radius:18px; --zr-radius-sm:12px;
  color-scheme:light;
}`;
}

const COMPONENT_CSS = `
.zanbi-report *,.zanbi-report *::before,.zanbi-report *::after{box-sizing:border-box}
.zanbi-report{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--zr-ink); background:var(--zr-canvas);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  font-size:16px; line-height:1.5; min-height:100%;
}
.zanbi-report ::selection{background:color-mix(in srgb,var(--zr-brand) 24%,transparent)}

/* Top bar */
.zr-topbar{
  position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:10px;
  padding:12px clamp(16px,4vw,28px); background:color-mix(in srgb,var(--zr-canvas) 82%,transparent);
  backdrop-filter:saturate(1.4) blur(12px); -webkit-backdrop-filter:saturate(1.4) blur(12px);
  border-bottom:1px solid var(--zr-line);
}
.zr-topbar-org{font-weight:700; letter-spacing:-.01em}
.zr-topbar-label{margin-left:auto; font-size:12px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--zr-muted)}

.zr-main{max-width:820px; margin:0 auto; padding:clamp(16px,4vw,32px) clamp(16px,4vw,28px) 64px}

/* Cards (uniform collapsible panels) */
.zr-panels{display:flex; flex-direction:column; gap:12px}
.zr-panel{
  background:var(--zr-surface); border:1px solid var(--zr-line); border-radius:var(--zr-radius);
  box-shadow:var(--zr-shadow); overflow:hidden;
}
.zr-panel-head{
  display:flex; align-items:center; gap:12px; padding:16px 18px; cursor:pointer;
  list-style:none; user-select:none;
}
.zr-panel-head::-webkit-details-marker{display:none}
.zr-panel-head:focus-visible{outline:3px solid var(--zr-brand-2); outline-offset:-3px}
.zr-panel-title{font-size:1.08rem; font-weight:700; letter-spacing:-.01em; margin:0}
.zr-chev{margin-left:auto; width:10px; height:10px; border-right:2px solid var(--zr-faint); border-bottom:2px solid var(--zr-faint); transform:rotate(45deg); transition:transform .18s ease; flex:none}
.zr-panel[open] > .zr-panel-head .zr-chev{transform:rotate(225deg)}
.zr-panel-body{padding:2px 18px 18px}

/* Header (a collapsible card) — after .zr-panel so its overrides win by order */
.zr-panel.zr-header{background:linear-gradient(180deg,var(--zr-surface),var(--zr-surface-2)); position:relative}
.zr-header::before{content:""; position:absolute; inset:0 0 auto 0; height:4px; z-index:1; background:linear-gradient(90deg,var(--zr-brand),var(--zr-brand-2))}
.zr-header-head{align-items:flex-start; padding:clamp(20px,4.5vw,30px)}
.zr-header-id{min-width:0}
.zr-header-chev{margin-top:9px}
.zr-header-flat{background:linear-gradient(180deg,var(--zr-surface),var(--zr-surface-2)); border:1px solid var(--zr-line); border-radius:var(--zr-radius); box-shadow:var(--zr-shadow); padding:clamp(20px,4.5vw,30px); position:relative; overflow:hidden}
.zr-header-body{padding:0 clamp(20px,4.5vw,30px) clamp(18px,4vw,26px)}
.zr-eyebrow{font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--zr-brand-2); margin-bottom:10px}
.zr-address{font-size:clamp(1.5rem,5vw,2.1rem); line-height:1.12; font-weight:800; letter-spacing:-.02em; margin:0; text-wrap:balance}
.zr-address-sub{color:var(--zr-muted); margin-top:6px; font-size:1.02rem}
.zr-meta{display:grid; grid-template-columns:1fr 1fr; gap:2px 28px; margin:0; padding:16px 0 0; border-top:1px solid var(--zr-line)}
.zr-meta-row{display:flex; flex-direction:column; gap:2px; padding:8px 0}
.zr-meta-label{font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--zr-faint)}
.zr-meta-value{font-size:1rem; font-weight:600; color:var(--zr-ink)}

/* Field list */
.zr-fields{display:grid; grid-template-columns:minmax(120px,34%) 1fr; gap:0; margin:0}
.zr-label{font-size:13px; font-weight:600; color:var(--zr-muted); padding:11px 14px 11px 0; border-top:1px solid var(--zr-line-2); align-self:start}
.zr-value{font-size:15px; color:var(--zr-ink); padding:11px 0; border-top:1px solid var(--zr-line-2); margin:0; overflow-wrap:anywhere}
.zr-fields > .zr-label:first-child,.zr-fields > .zr-label:first-child + .zr-value{border-top:none}
.zr-multiline{white-space:normal; line-height:1.6}
.zr-heading{grid-column:1/-1; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--zr-brand-2); margin:16px 0 2px; padding-top:12px; border-top:1px solid var(--zr-line-2)}
.zr-fields > .zr-heading:first-child{border-top:none; margin-top:4px}

/* Pills + chips */
.zr-pill{display:inline-flex; align-items:center; font-size:13px; font-weight:700; padding:3px 11px; border-radius:999px; line-height:1.4}
.zr-pill.is-yes{color:#0b7a3b; background:#dcfce7} .zr-pill.is-no{color:#8a5a00; background:#fef3c7}
.zr-chip{display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--chip); background:var(--chip-bg); padding:4px 11px; border-radius:999px; line-height:1.4}
.zr-chip-sm{font-size:12px; padding:3px 9px; margin-left:auto}
.zr-panel-title + .zr-chip-sm{margin-left:auto}
.zr-dot{width:7px; height:7px; border-radius:50%; background:var(--chip); flex:none}

/* Photos */
.zr-photos{display:grid; grid-template-columns:repeat(var(--zr-photo-cols,auto-fill),minmax(var(--zr-photo-min,148px),1fr)); gap:10px; margin-top:16px}
.zr-photo{position:relative; appearance:none; padding:0; border:1px solid var(--zr-line); background:var(--zr-surface-2); border-radius:14px; overflow:hidden; cursor:zoom-in; aspect-ratio:4/3; display:block}
.zr-photo:focus-visible{outline:3px solid var(--zr-brand-2); outline-offset:2px}
.zr-photo img{width:100%; height:100%; object-fit:cover; display:block}
.zr-noimg{display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:32px; color:var(--zr-faint)}
.zr-photo-cap{position:absolute; left:0; right:0; bottom:0; padding:14px 10px 7px; font-size:11px; font-weight:600; color:#fff; text-align:left; background:linear-gradient(transparent,rgba(0,0,0,.66)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.zr-badge-markup{position:absolute; top:7px; right:7px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:12px; color:#fff; background:rgba(20,22,44,.62); border-radius:7px; backdrop-filter:blur(4px)}

.zr-empty{color:var(--zr-muted); text-align:center; padding:48px 0}

/* Footer */
.zr-footer{margin-top:40px; padding-top:22px; border-top:1px solid var(--zr-line); text-align:center; color:var(--zr-muted)}
.zr-foot-org{font-weight:700; color:var(--zr-ink-2)}
.zr-foot-gen{font-size:13px; margin-top:3px}
.zr-foot-note{font-size:12px; margin-top:10px; color:var(--zr-faint); max-width:44ch; margin-inline:auto}

/* Lightbox */
.zr-lightbox{position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:rgba(8,9,16,.92); backdrop-filter:blur(6px); padding:24px}
.zr-lightbox[hidden]{display:none}
.zr-lb-figure{margin:0; max-width:min(1100px,94vw); max-height:88vh; display:flex; flex-direction:column; align-items:center; gap:14px}
.zr-lb-img{max-width:100%; max-height:78vh; object-fit:contain; border-radius:10px; box-shadow:var(--zr-shadow-lg)}
.zr-lb-cap{color:#e9eaf2; font-size:14px; text-align:center; max-width:60ch}
.zr-lb-close,.zr-lb-prev,.zr-lb-next{position:absolute; appearance:none; cursor:pointer; color:#fff; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); border-radius:50%; width:48px; height:48px; font-size:22px; line-height:1; display:flex; align-items:center; justify-content:center}
.zr-lb-close{top:18px; right:18px}
.zr-lb-prev{left:16px; top:50%; transform:translateY(-50%)}
.zr-lb-next{right:16px; top:50%; transform:translateY(-50%)}
.zr-lb-close:focus-visible,.zr-lb-prev:focus-visible,.zr-lb-next:focus-visible{outline:3px solid #fff; outline-offset:2px}
.zr-lb-prev:hover,.zr-lb-next:hover,.zr-lb-close:hover{background:rgba(255,255,255,.22)}

@media (max-width:560px){
  .zr-meta{grid-template-columns:1fr; gap:0}
  .zr-fields{grid-template-columns:1fr; gap:0}
  .zr-label{padding-bottom:1px; border-top:1px solid var(--zr-line-2)}
  .zr-value{padding-top:2px; border-top:none}
  .zr-fields > .zr-label:first-child + .zr-value{border-top:none}
  .zr-lb-prev,.zr-lb-next{width:44px; height:44px}
}
@media (prefers-reduced-motion:reduce){
  .zanbi-report *{transition:none !important; scroll-behavior:auto !important}
}
`;

// ── Interaction JS (vanilla, scoped, progressive-enhancement) ─────────────────
const SCRIPT = `
(function(){
  var root=document.currentScript ? document.currentScript.closest(".zanbi-report") : null;
  root=root||document.querySelector(".zanbi-report"); if(!root) return;

  // Lightbox
  var lb=root.querySelector(".zr-lightbox");
  var lbImg=lb && lb.querySelector(".zr-lb-img");
  var lbCap=lb && lb.querySelector(".zr-lb-cap");
  var gallery=[], idx=0, lastFocus=null;
  function buildGallery(){
    gallery=[].slice.call(root.querySelectorAll(".zr-photo")).filter(function(b){return b.getAttribute("data-full");});
  }
  function show(i){
    if(!gallery.length) return;
    idx=(i+gallery.length)%gallery.length;
    var b=gallery[idx];
    lbImg.src=b.getAttribute("data-full");
    lbImg.alt=b.getAttribute("data-cap")||"Inspection photo";
    lbCap.textContent=b.getAttribute("data-cap")||"";
    lbCap.style.display=b.getAttribute("data-cap")?"":"none";
  }
  function open(b){
    buildGallery(); var i=gallery.indexOf(b); if(i<0) return;
    lastFocus=document.activeElement; lb.hidden=false; lb.setAttribute("aria-hidden","false");
    document.documentElement.style.overflow="hidden"; show(i);
    (lb.querySelector(".zr-lb-close")||lb).focus();
  }
  function close(){
    lb.hidden=true; lb.setAttribute("aria-hidden","true"); document.documentElement.style.overflow="";
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  root.addEventListener("click", function(e){
    var ph=e.target.closest(".zr-photo"); if(ph && ph.getAttribute("data-full")){ open(ph); return; }
  });
  if(lb){
    lb.querySelector(".zr-lb-close").addEventListener("click", close);
    lb.querySelector(".zr-lb-prev").addEventListener("click", function(){ show(idx-1); });
    lb.querySelector(".zr-lb-next").addEventListener("click", function(){ show(idx+1); });
    lb.addEventListener("click", function(e){ if(e.target===lb) close(); });
    document.addEventListener("keydown", function(e){
      if(lb.hidden) return;
      if(e.key==="Escape") close();
      else if(e.key==="ArrowLeft") show(idx-1);
      else if(e.key==="ArrowRight") show(idx+1);
    });
  }
})();
`;

// ── Public API ────────────────────────────────────────────────────────────────
export function renderReportFragment(model, opts = {}) {
  return `<style>${tokenBlock(".zanbi-report")}${COMPONENT_CSS}</style>
${renderBodyMarkup(model, opts)}
<script>${SCRIPT}</script>`;
}

export function renderReportHtml(model, opts = {}) {
  const title =
    opts.title ||
    `Inspection Report — ${model.meta?.property?.addressStreet || model.meta?.client?.name || "Zanbi"}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<style>
html,body{margin:0;padding:0}
${tokenBlock(":root")}
body{background:var(--zr-canvas)}
${COMPONENT_CSS}
</style>
</head>
<body>
${renderBodyMarkup(model, opts)}
<script>${SCRIPT}</script>
</body>
</html>`;
}

export default renderReportHtml;
