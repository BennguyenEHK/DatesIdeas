import { afterEach, describe, expect, it } from "vitest";

import {
  PERSON_BLUR_ALPHA,
  PERSON_BLUR_PX,
  paintShot,
  paintStrip,
  shotPreview,
  type Shot,
} from "./paint";
import { STRIP_WIDTH, stripLayout } from "./strip";
import { starsFor, theme } from "./themes";

type Call = [string, ...unknown[]];

class RecordingGradient {
  readonly stops: Array<[number, string]> = [];

  constructor(
    private readonly calls: Call[],
    private readonly kind: "linear" | "radial",
  ) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
    this.calls.push([`${this.kind}Stop`, offset, color]);
  }
}

class RecordingContext {
  readonly calls: Call[] = [];
  private readonly states: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    globalAlpha: number;
    filter: string;
  }> = [];
  private composite: GlobalCompositeOperation = "source-over";
  private alpha = 1;
  private currentFilter = "none";
  fillStyle: string | CanvasGradient = "#000";
  strokeStyle: string | CanvasGradient = "#000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  get globalCompositeOperation(): GlobalCompositeOperation { return this.composite; }
  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.composite = value;
    this.calls.push(["setComposite", value]);
  }
  get globalAlpha(): number { return this.alpha; }
  set globalAlpha(value: number) {
    this.alpha = value;
    this.calls.push(["setAlpha", value]);
  }
  get filter(): string { return this.currentFilter; }
  set filter(value: string) {
    this.currentFilter = value;
    this.calls.push(["setFilter", value]);
  }

  save(): void {
    this.calls.push(["save"]);
    this.states.push({
      globalCompositeOperation: this.composite,
      globalAlpha: this.alpha,
      filter: this.currentFilter,
    });
  }
  restore(): void {
    this.calls.push(["restore"]);
    const state = this.states.pop();
    if (!state) throw new Error("restore without save");
    this.composite = state.globalCompositeOperation;
    this.alpha = state.globalAlpha;
    this.currentFilter = state.filter;
  }
  createLinearGradient(...args: number[]): CanvasGradient {
    this.calls.push(["linear", ...args]);
    return new RecordingGradient(this.calls, "linear") as unknown as CanvasGradient;
  }
  createRadialGradient(...args: number[]): CanvasGradient {
    this.calls.push(["radial", ...args]);
    return new RecordingGradient(this.calls, "radial") as unknown as CanvasGradient;
  }
  translate(...args: number[]): void { this.calls.push(["translate", ...args]); }
  scale(...args: number[]): void { this.calls.push(["scale", ...args]); }
  fillRect(...args: number[]): void { this.calls.push(["fillRect", ...args]); }
  strokeRect(...args: number[]): void { this.calls.push(["strokeRect", ...args]); }
  drawImage(image: CanvasImageSource, ...args: number[]): void {
    this.calls.push(["drawImage", image, ...args]);
  }
  beginPath(): void { this.calls.push(["beginPath"]); }
  arc(...args: number[]): void { this.calls.push(["arc", ...args]); }
  fill(): void { this.calls.push(["fill"]); }
  fillText(...args: [string, number, number]): void { this.calls.push(["fillText", ...args]); }
}

function ctx(): RecordingContext {
  return new RecordingContext();
}

function shots(): Shot[] {
  return [{ left: {} as CanvasImageSource, right: {} as CanvasImageSource }];
}

describe("paintStrip", () => {
  it("layers the scene in photographic order and finishes with the caption", () => {
    const context = ctx();
    const layout = stripLayout(2, 200);
    paintStrip(context as unknown as CanvasRenderingContext2D, layout, theme("griffith"), shots(), "Tonight");

    const names = context.calls.map(([name]) => name);
    expect(names.indexOf("linear")).toBeLessThan(names.indexOf("drawImage"));
    const grade = names.indexOf("setComposite");
    expect(names.indexOf("drawImage")).toBeLessThan(grade);
    expect(grade).toBeLessThan(names.lastIndexOf("radial"));
    expect(names.lastIndexOf("radial")).toBeLessThan(names.indexOf("strokeRect"));
    expect(names.at(-2)).toBe("fillText");
  });

  it("grades panels only and restores drawing state", () => {
    const context = ctx();
    const layout = stripLayout(2, 200);
    const themed = theme("griffith");
    paintStrip(context as unknown as CanvasRenderingContext2D, layout, themed, shots(), "Tonight");

    const gradeStart = context.calls.findIndex(([name, mode]) =>
      name === "setComposite" && mode === themed.grade?.mode,
    );
    const gradeEnd = context.calls.findIndex(([name], index) => index > gradeStart && name === "restore");
    const gradeRects = context.calls.slice(gradeStart, gradeEnd).filter(([name]) => name === "fillRect");
    const panelRects = gradeRects.filter(([name, x, y, width, height]) =>
      name === "fillRect" && layout.panels.some((panel) =>
        panel.x === x && panel.y === y && panel.width === width && panel.height === height,
      ),
    );
    expect(gradeStart).not.toBe(-1);
    expect(panelRects).toHaveLength(layout.panels.length);
    expect(gradeRects).not.toContainEqual(["fillRect", layout.caption.x, layout.caption.y, layout.caption.width, layout.caption.height]);
    expect(context.calls.filter(([name]) => name === "save")).toHaveLength(context.calls.filter(([name]) => name === "restore").length);
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(context.globalAlpha).toBe(1);
  });

  it("uses the deterministic stars from the theme on every run", () => {
    const layout = stripLayout(2, 200);
    const first = ctx();
    const second = ctx();
    const themed = theme("planetarium");
    paintStrip(first as unknown as CanvasRenderingContext2D, layout, themed, [], "Tonight");
    paintStrip(second as unknown as CanvasRenderingContext2D, layout, themed, [], "Tonight");

    const arcs = first.calls.filter(([name]) => name === "arc");
    expect(arcs).toEqual(second.calls.filter(([name]) => name === "arc"));
    expect(arcs).toEqual(starsFor(themed).map((star) => [
      "arc",
      star.x * layout.width,
      star.y * layout.height,
      star.radius * layout.width,
      0,
      Math.PI * 2,
    ]));
  });

  it("leaves a null half as sky and safely accepts fewer shots than panels", () => {
    const context = ctx();
    const layout = stripLayout(2, 200);
    const left = {} as CanvasImageSource;
    expect(() => paintStrip(context as unknown as CanvasRenderingContext2D, layout, theme("griffith"), [{ left, right: null }], "Tonight")).not.toThrow();
    expect(context.calls.filter(([name]) => name === "drawImage")).toHaveLength(2);
  });

  it("crops a wide source with the nine-argument drawImage overload", () => {
    const context = ctx();
    const layout = stripLayout(2, 200);
    const source = { width: 1600, height: 900 } as CanvasImageSource;
    paintStrip(context as unknown as CanvasRenderingContext2D, layout, theme("griffith"), [{ left: source, right: null }], "Tonight");

    const draw = context.calls.find(([name, image]) => name === "drawImage" && image === source);
    expect(draw).toEqual([
      "drawImage",
      source,
      400,
      0,
      800,
      900,
      layout.panels[0].left.x,
      layout.panels[0].left.y,
      layout.panels[0].left.width,
      layout.panels[0].left.height,
    ]);
  });

  it("does not paint a grade for an ungraded theme", () => {
    const context = ctx();
    paintStrip(context as unknown as CanvasRenderingContext2D, stripLayout(2, 200), theme("silver"), shots(), "Tonight");

    expect(context.calls.filter(([name]) => name === "setComposite")).toHaveLength(0);
  });
});

/**
 * The feather, on the path a real browser actually takes.
 *
 * jsdom has no working canvas, so every other test in this file silently
 * exercises the unfeathered fallback: paintPerson cannot get a 2d context for
 * its offscreen canvas and draws straight to the strip. That fallback is worth
 * having, but it is not what anyone sees. Standing an OffscreenCanvas up on
 * globalThis is what puts the real path under test.
 */
class FakeOffscreen {
  static made: FakeOffscreen[] = [];
  readonly context = new RecordingContext();
  constructor(readonly width: number, readonly height: number) {
    FakeOffscreen.made.push(this);
  }
  getContext(): unknown {
    return this.context;
  }
}

describe("feathering the two halves into one photograph", () => {
  afterEach(() => {
    delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    FakeOffscreen.made = [];
  });

  function paintOneHalf() {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreen;
    const context = ctx();
    const layout = stripLayout(2, 200);
    const source = { width: 1600, height: 900 } as CanvasImageSource;
    paintStrip(
      context as unknown as CanvasRenderingContext2D,
      layout,
      theme("griffith"),
      [{ left: source, right: null }],
      "Tonight",
    );
    return { context, layout, source };
  }

  it("crops into an offscreen canvas the size of the person's place on the strip", () => {
    const { layout, source } = paintOneHalf();
    const dest = layout.panels[0].left;

    expect(FakeOffscreen.made).toHaveLength(1);
    const off = FakeOffscreen.made[0];
    expect([off.width, off.height]).toEqual([dest.width, dest.height]);
    // Same centre crop as the fallback, but landing at the offscreen origin.
    expect(off.context.calls.find(([name]) => name === "drawImage")).toEqual([
      "drawImage", source, 400, 0, 800, 900, 0, 0, dest.width, dest.height,
    ]);
  });

  it("punches an elliptical hole matching the live preview's mask", () => {
    const { layout } = paintOneHalf();
    const dest = layout.panels[0].left;
    const calls = FakeOffscreen.made[0].context.calls;

    expect(calls).toContainEqual(["setComposite", "destination-in"]);
    expect(calls).toContainEqual(["translate", dest.width * 0.5, dest.height * 0.46]);
    expect(calls).toContainEqual(["scale", dest.width * 0.68, dest.height * 0.82]);
    // Opaque out to 58% of the radius, gone by the edge -- the CSS the stage
    // feathers itself with, so the strip cannot drift away from the preview.
    expect(calls).toContainEqual(["radialStop", 0.58, "#000"]);
    expect(calls).toContainEqual(["radialStop", 1, "rgba(0,0,0,0)"]);
  });

  it("lays the feathered half onto the strip in its own place", () => {
    const { context, layout } = paintOneHalf();
    const dest = layout.panels[0].left;

    expect(context.calls).toContainEqual([
      "drawImage", FakeOffscreen.made[0], dest.x, dest.y, dest.width, dest.height,
    ]);
  });

  it("puts the two people flush against each other, with no gap to feather across", () => {
    const layout = stripLayout(2, 200);
    const { left, right } = layout.panels[0];
    expect(left.x + left.width).toBe(right.x);
  });

  it("puts a blurred, unfeathered room behind the sharp feathered person", () => {
    const { context, layout, source } = paintOneHalf();
    const dest = layout.panels[0].left;
    const backdrop = context.calls.findIndex(([name, image]) => name === "drawImage" && image === source);
    const blur = context.calls.findIndex(([name, value]) => name === "setFilter" && value === `blur(${Math.max(1, Math.round(PERSON_BLUR_PX * (layout.width / STRIP_WIDTH)))}px)`);
    const alpha = context.calls.findIndex(([name, value]) => name === "setAlpha" && value === PERSON_BLUR_ALPHA);
    const sharp = context.calls.findIndex(([name, image]) => name === "drawImage" && image === FakeOffscreen.made[0]);

    expect(backdrop).toBeGreaterThan(blur);
    expect(backdrop).toBeGreaterThan(alpha);
    expect(backdrop).toBeLessThan(sharp);
    expect(context.calls[backdrop]).toEqual([
      "drawImage", source, 400, 0, 800, 900, dest.x, dest.y, dest.width, dest.height,
    ]);
    expect(FakeOffscreen.made[0].context.calls.some(([name]) => name === "setFilter")).toBe(false);
  });

  it("scales the blur with the requested strip width and restores its state", () => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreen;
    const context = ctx();
    const layout = stripLayout(2, STRIP_WIDTH / 2);
    const source = { width: 1600, height: 900 } as CanvasImageSource;
    paintStrip(context as unknown as CanvasRenderingContext2D, layout, theme("griffith"), [{ left: source, right: null }], "Tonight");

    const blur = `blur(${PERSON_BLUR_PX / 2}px)`;
    const blurIndex = context.calls.findIndex(([name, value]) => name === "setFilter" && value === blur);
    const backdropIndex = context.calls.findIndex(([name, image]) => name === "drawImage" && image === source);
    const restoreIndex = context.calls.findIndex(([name], index) => index > backdropIndex && name === "restore");

    expect(blurIndex).toBeLessThan(backdropIndex);
    expect(restoreIndex).toBeGreaterThan(backdropIndex);
    expect(context.globalAlpha).toBe(1);
    expect(context.filter).toBe("none");
  });
});

describe("the photograph held up after each flash", () => {
  const box = { width: 320, height: 180 };

  /**
   * The bug this exists to prevent. The preview used to be the local capture
   * alone, so on your screen it held up you and on theirs it held up them, and
   * neither of you saw the two of you together until the strip developed.
   */
  it("draws both people, not just the local one", () => {
    const context = ctx();
    const left = {} as CanvasImageSource;
    const right = {} as CanvasImageSource;
    paintShot(
      context as unknown as CanvasRenderingContext2D,
      theme("griffith"),
      { left, right },
      box,
    );

    const drawn = context.calls.filter(([name]) => name === "drawImage");
    expect(drawn.some((call) => call[1] === left)).toBe(true);
    expect(drawn.some((call) => call[1] === right)).toBe(true);
  });

  it("gives each person exactly half the frame, flush against the other", () => {
    const context = ctx();
    paintShot(
      context as unknown as CanvasRenderingContext2D,
      theme("griffith"),
      { left: {} as CanvasImageSource, right: {} as CanvasImageSource },
      box,
    );

    // The feathered halves are laid down with the five-argument overload at
    // their destination, which is where the split is observable.
    const placed = context.calls
      .filter(([name, , x]) => name === "drawImage" && typeof x === "number")
      .map(([, , x, , w]) => [x, w]);
    expect(placed).toContainEqual([0, box.width / 2]);
    expect(placed).toContainEqual([box.width / 2, box.width / 2]);
  });

  it("paints the scene first and the grade last, like the strip does", () => {
    const context = ctx();
    paintShot(
      context as unknown as CanvasRenderingContext2D,
      theme("griffith"),
      { left: {} as CanvasImageSource, right: null },
      box,
    );

    const names = context.calls.map(([name]) => name);
    expect(names.indexOf("linear")).toBeLessThan(names.indexOf("drawImage"));
    expect(names.indexOf("drawImage")).toBeLessThan(names.indexOf("setComposite"));
  });

  it("still paints the scene when one camera gave nothing", () => {
    const context = ctx();
    paintShot(
      context as unknown as CanvasRenderingContext2D,
      theme("griffith"),
      { left: null, right: {} as CanvasImageSource },
      box,
    );

    const names = context.calls.map(([name]) => name);
    expect(names).toContain("linear");
    expect(names).toContain("drawImage");
  });

  it("refuses to make a preview of two missing cameras", () => {
    expect(shotPreview(theme("griffith"), { left: null, right: null })).toBeNull();
  });
});
