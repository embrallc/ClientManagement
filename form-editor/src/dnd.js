// Native HTML5 drag-and-drop wiring. Custom MIME types keep our payloads from
// colliding with text drops, and native DnD is what lets binding chips drop
// straight into Tiptap editors at the caret position.
export const MIME = {
  element: "application/x-zanbi-element",
  shape: "application/x-zanbi-shape",
  band: "application/x-zanbi-band",
  binding: "application/x-zanbi-binding",
};

export function setPayload(e, mime, payload) {
  e.dataTransfer.setData(mime, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
}

export function getPayload(e, mime) {
  const raw = e.dataTransfer.getData(mime);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function hasType(e, mime) {
  return Array.from(e.dataTransfer?.types ?? []).includes(mime);
}

// Pointer position → band-local coordinates, compensating for canvas zoom.
export function dropPoint(e, hostEl, zoom) {
  const rect = hostEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoom,
    y: (e.clientY - rect.top) / zoom,
  };
}

// Candidate snap lines shared by move / resize / group-bbox snapping so all
// three agree on what "aligned" means: band left/center/right on X, plus every
// sibling's left/center/right (X) and top/middle/bottom (Y).
export function buildTargets(siblings, bandW) {
  const x = [0, bandW / 2, bandW];
  const y = [];
  for (const s of siblings) {
    x.push(s.frame.x, s.frame.x + s.frame.w / 2, s.frame.x + s.frame.w);
    y.push(s.frame.y, s.frame.y + s.frame.h / 2, s.frame.y + s.frame.h);
  }
  return { x, y };
}

// Nearest target within `threshold` px, or null.
function nearest(value, targets, threshold) {
  let best = null;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= threshold && (best === null || d < best.d)) best = { d, t };
  }
  return best ? best.t : null;
}

// Smart guides: snap a moving frame's edges/centers to siblings within
// `threshold` px and report the matched guide lines for rendering.
export function snapWithGuides(frame, siblings, bandW, threshold = 5) {
  const guides = [];
  let { x, y } = frame;
  const { x: targetsX, y: targetsY } = buildTargets(siblings, bandW);
  const movingX = [
    { v: x, apply: (g) => g },
    { v: x + frame.w / 2, apply: (g) => g - frame.w / 2 },
    { v: x + frame.w, apply: (g) => g - frame.w },
  ];
  const movingY = [
    { v: y, apply: (g) => g },
    { v: y + frame.h / 2, apply: (g) => g - frame.h / 2 },
    { v: y + frame.h, apply: (g) => g - frame.h },
  ];
  let bestX = null;
  for (const m of movingX) {
    for (const t of targetsX) {
      const d = Math.abs(m.v - t);
      if (d <= threshold && (bestX === null || d < bestX.d)) {
        bestX = { d, x: m.apply(t), line: t };
      }
    }
  }
  let bestY = null;
  for (const m of movingY) {
    for (const t of targetsY) {
      const d = Math.abs(m.v - t);
      if (d <= threshold && (bestY === null || d < bestY.d)) {
        bestY = { d, y: m.apply(t), line: t };
      }
    }
  }
  if (bestX) {
    x = bestX.x;
    guides.push({ axis: "x", pos: bestX.line });
  }
  if (bestY) {
    y = bestY.y;
    guides.push({ axis: "y", pos: bestY.line });
  }
  return { x, y, guides };
}

// Resize snapping: snap only the ACTIVE edges implied by `mode` (n/s/e/w letters)
// to the same targets, adjusting size (and x/y for the n/w edges, so the opposite
// edge stays put) rather than translating the whole frame. Returns the adjusted
// frame plus matched guide lines. Corner handles snap on both axes.
export function snapResize(frame, mode, siblings, bandW, threshold = 5) {
  const { x: targetsX, y: targetsY } = buildTargets(siblings, bandW);
  let { x, y, w, h } = frame;
  const guides = [];
  if (mode.includes("e")) {
    const t = nearest(x + w, targetsX, threshold);
    if (t !== null) {
      w = t - x;
      guides.push({ axis: "x", pos: t });
    }
  } else if (mode.includes("w")) {
    const right = x + w;
    const t = nearest(x, targetsX, threshold);
    if (t !== null) {
      x = t;
      w = right - t;
      guides.push({ axis: "x", pos: t });
    }
  }
  if (mode.includes("s")) {
    const t = nearest(y + h, targetsY, threshold);
    if (t !== null) {
      h = t - y;
      guides.push({ axis: "y", pos: t });
    }
  } else if (mode.includes("n")) {
    const bottom = y + h;
    const t = nearest(y, targetsY, threshold);
    if (t !== null) {
      y = t;
      h = bottom - t;
      guides.push({ axis: "y", pos: t });
    }
  }
  return { x, y, w, h, guides };
}
