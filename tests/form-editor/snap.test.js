import { describe, expect, it } from "vitest";
import { buildTargets, snapResize, snapWithGuides } from "../../form-editor/src/dnd.js";

// Snap targets are band-local px in a 720px content band; frames are {x,y,w,h}.
const BAND_W = 720;
const sib = (x, y, w, h) => ({ frame: { x, y, w, h } });

describe("buildTargets", () => {
  it("always includes band left/center/right on X and only sibling lines on Y", () => {
    const { x, y } = buildTargets([], BAND_W);
    expect(x).toEqual([0, 360, 720]);
    expect(y).toEqual([]);
  });

  it("adds each sibling's left/center/right (X) and top/middle/bottom (Y)", () => {
    const { x, y } = buildTargets([sib(100, 200, 50, 20)], BAND_W);
    expect(x).toEqual([0, 360, 720, 100, 125, 150]);
    expect(y).toEqual([200, 210, 220]);
  });
});

describe("snapWithGuides (move)", () => {
  it("snaps a near-aligned left edge to a sibling and reports an x guide", () => {
    const frame = { x: 100, y: 100, w: 50, h: 20 };
    const res = snapWithGuides(frame, [sib(103, 300, 50, 20)], BAND_W);
    expect(res.x).toBe(103); // left edge pulled 3px onto the sibling
    expect(res.y).toBe(100); // sibling is far on Y → untouched
    expect(res.guides).toContainEqual({ axis: "x", pos: 103 });
    expect(res.guides.some((g) => g.axis === "y")).toBe(false);
  });

  it("snaps the frame center to the band center", () => {
    const frame = { x: 312, y: 500, w: 100, h: 20 }; // center 362, 2px off 360
    const res = snapWithGuides(frame, [], BAND_W);
    expect(res.x).toBe(310); // center 360 → x = 360 - 50
    expect(res.guides).toContainEqual({ axis: "x", pos: 360 });
  });

  it("returns the frame unchanged with no guides beyond the threshold", () => {
    const frame = { x: 200, y: 200, w: 20, h: 20 };
    const res = snapWithGuides(frame, [], BAND_W);
    expect(res).toEqual({ x: 200, y: 200, guides: [] });
  });

  it("snaps top/bottom edges on the Y axis", () => {
    const frame = { x: 500, y: 98, w: 40, h: 20 };
    const res = snapWithGuides(frame, [sib(500, 100, 40, 20)], BAND_W);
    expect(res.y).toBe(100);
    expect(res.guides).toContainEqual({ axis: "y", pos: 100 });
  });
});

describe("snapResize (resize edges)", () => {
  it("e-handle: snaps the right edge, growing width, left edge fixed", () => {
    const frame = { x: 100, y: 100, w: 48, h: 40 }; // right 148
    const r = snapResize(frame, "e", [sib(150, 100, 30, 40)], BAND_W);
    expect(r.x).toBe(100); // left edge unmoved
    expect(r.w).toBe(50); // right snapped to sibling left (150)
    expect(r.guides).toContainEqual({ axis: "x", pos: 150 });
  });

  it("w-handle: snaps the left edge, keeping the right edge fixed", () => {
    const frame = { x: 98, y: 100, w: 102, h: 40 }; // right 200
    const r = snapResize(frame, "w", [sib(100, 100, 40, 40)], BAND_W);
    expect(r.x).toBe(100); // left snapped
    expect(r.w).toBe(100); // right (200) held → 200 - 100
    expect(r.guides).toContainEqual({ axis: "x", pos: 100 });
  });

  it("s-handle: snaps the bottom edge, growing height", () => {
    const frame = { x: 100, y: 100, w: 40, h: 48 }; // bottom 148
    const r = snapResize(frame, "s", [sib(400, 150, 40, 20)], BAND_W);
    expect(r.y).toBe(100);
    expect(r.h).toBe(50);
    expect(r.guides).toContainEqual({ axis: "y", pos: 150 });
  });

  it("n-handle: snaps the top edge, keeping the bottom fixed", () => {
    const frame = { x: 100, y: 98, w: 40, h: 102 }; // bottom 200
    const r = snapResize(frame, "n", [sib(400, 100, 40, 20)], BAND_W);
    expect(r.y).toBe(100);
    expect(r.h).toBe(100); // 200 - 100
    expect(r.guides).toContainEqual({ axis: "y", pos: 100 });
  });

  it("se corner: snaps both the right and bottom edges", () => {
    const frame = { x: 100, y: 100, w: 48, h: 48 };
    const r = snapResize(frame, "se", [sib(150, 100, 30, 30), sib(100, 150, 30, 30)], BAND_W);
    expect(r.w).toBe(50); // right → 150
    expect(r.h).toBe(50); // bottom → 150
    expect(r.guides).toHaveLength(2);
  });

  it("leaves the frame untouched with no guides beyond the threshold", () => {
    const frame = { x: 10, y: 10, w: 20, h: 20 };
    const r = snapResize(frame, "e", [sib(200, 200, 40, 40)], BAND_W);
    expect(r).toEqual({ x: 10, y: 10, w: 20, h: 20, guides: [] });
  });
});

describe("group / multi-move (bbox snapped via snapWithGuides)", () => {
  it("snaps a selection bounding box's right edge to a sibling and yields the correction", () => {
    // Two-leaf selection → bbox {100,100,100,40}; a sibling sits just past its right edge.
    const bbox = { x: 100, y: 100, w: 100, h: 40 }; // right 200
    const res = snapWithGuides(bbox, [sib(203, 400, 50, 20)], BAND_W);
    expect(res.x).toBe(103); // right edge (200) pulled onto sibling left (203) → +3
    expect(res.x - bbox.x).toBe(3); // this is the delta correction the hook applies
    expect(res.guides).toContainEqual({ axis: "x", pos: 203 });
  });
});
