import { describe, expect, it } from "vitest";

import { paintStrip, type Shot } from "./paint";
import { stripLayout } from "./strip";
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
    expect(context.calls.filter(([name]) => name === "drawImage")).toHaveLength(1);
  });

  it("does not paint a grade for an ungraded theme", () => {
    const context = ctx();
    paintStrip(context as unknown as CanvasRenderingContext2D, stripLayout(2, 200), theme("silver"), shots(), "Tonight");

    expect(context.calls.filter(([name]) => name === "setComposite")).toHaveLength(0);
  });
});
