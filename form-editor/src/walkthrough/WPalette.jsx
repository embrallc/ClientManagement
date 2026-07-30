import { DND_NEW_FIELD, PALETTE_FIELDS } from "./model";
import { useWalkthroughStore } from "./store";

// Resolve which section a click-to-add field should land in: the selected
// section (or the section of the selected field), else the last section.
function targetSectionId(state) {
  if (state.selected?.sectionId) return state.selected.sectionId;
  const secs = state.template?.sections ?? [];
  return secs.length ? secs[secs.length - 1].id : null;
}

export default function WPalette() {
  const addSection = useWalkthroughStore((s) => s.addSection);
  const addField = useWalkthroughStore((s) => s.addField);

  function handleAddField(type) {
    const state = useWalkthroughStore.getState();
    const secId = targetSectionId(state);
    if (!secId) {
      window.alert("Add a section first, then add fields into it.");
      return;
    }
    addField(secId, type);
  }

  return (
    <div className="palette">
      <h3>Sections</h3>
      <div className="wt-add-col" data-tour="wt-sections">
        <button
          className="palette-item wide band-static"
          onClick={() => addSection("static")}
          title="A fixed set of questions, filled out once (e.g. always check appliances, carpet, bathrooms)."
        >
          <span className="glyph">▬</span>
          <span className="pi-text">
            Fixed
            <span className="pi-sub">Same questions every time — filled out once.</span>
          </span>
        </button>
        <button
          className="palette-item wide band-repeat"
          onClick={() => addSection("repeatable")}
          title="Inspectors add as many entries as they need — one per item they find (e.g. one per roof issue)."
        >
          <span className="glyph">⧉</span>
          <span className="pi-text">
            Add as Needed
            <span className="pi-sub">Inspector adds one entry per item they find.</span>
          </span>
        </button>
      </div>

      <h3>Fields</h3>
      <p className="hint">
        Click to add to the selected section, or drag onto the page.
      </p>
      <div className="palette-grid" data-tour="wt-fields">
        {PALETTE_FIELDS.map((f) => (
          <div
            key={f.type}
            className="palette-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_NEW_FIELD, f.type);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => handleAddField(f.type)}
            title={f.label}
          >
            <span className="glyph">{f.glyph}</span> {f.label}
          </div>
        ))}
      </div>

      <h3>Tips</h3>
      <p className="hint">
        <b>Add-as-Needed sections</b> get stamped out once per item the
        inspector logs — design it once, it repeats automatically in the report.
      </p>
      <p className="hint">
        The page in the middle is a live preview: it shows exactly what your
        inspectors will tap through on their phones.
      </p>
    </div>
  );
}
