import { describe, expect, it } from "vitest";
import { fitContain, paintScene, type CanvasPainter } from "./render";
import type { Scene } from "./ops";

class RecordingPainter implements CanvasPainter {
  calls: string[] = [];
  fillStyle = "";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  font = "";
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  lineWidth = 1;
  strokeStyle = "";
  shadowBlur = 0;
  shadowColor = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc(x: number, y: number, radius: number): void {
    this.calls.push(`arc ${x} ${y} ${radius}`);
  }

  beginPath(): void {
    this.calls.push("beginPath");
  }

  fill(): void {
    this.calls.push("fill");
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push(`fillText ${text} ${x} ${y}`);
  }

  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo ${x} ${y}`);
  }

  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo ${x} ${y}`);
  }

  restore(): void {
    this.calls.push("restore");
  }

  rotate(angle: number): void {
    this.calls.push(`rotate ${angle}`);
  }

  save(): void {
    this.calls.push("save");
  }

  stroke(): void {
    this.calls.push("stroke");
  }

  translate(x: number, y: number): void {
    this.calls.push(`translate ${x} ${y}`);
  }
}

describe("fitContain", () => {
  it("centres an image while preserving its aspect ratio", () => {
    expect(fitContain(400, 200, 300, 300)).toEqual({ x: 0, y: 75, width: 300, height: 150 });
  });
});

describe("paintScene", () => {
  it("draws a single point as a round dot", () => {
    const painter = new RecordingPainter();
    const scene: Scene = {
      items: [
        {
          type: "stroke",
          id: "dot",
          author: "me",
          at: 1,
          ink: "#e8b94a",
          width: 0.1,
          points: [[0.25, 0.5]],
        },
      ],
    };

    paintScene(painter, scene, 200, 100);

    expect(painter.lineWidth).toBe(20);
    expect(painter.lineCap).toBe("round");
    expect(painter.lineJoin).toBe("round");
    expect(painter.calls).toEqual(["save", "beginPath", "arc 50 50 10", "fill", "restore"]);
  });

  it("paints stickers in scene order with their rotation", () => {
    const painter = new RecordingPainter();
    const scene: Scene = {
      items: [
        {
          type: "sticker",
          id: "star",
          author: "me",
          at: 1,
          glyph: "⭐",
          x: 0.5,
          y: 0.25,
          scale: 1,
          rotation: 90,
        },
      ],
    };

    paintScene(painter, scene, 200, 100);

    expect(painter.calls).toEqual([
      "save",
      "translate 100 25",
      `rotate ${Math.PI / 2}`,
      "fillText ⭐ 0 0",
      "restore",
    ]);
  });

  it("uses destination-out for eraser marks and restores the drawing state", () => {
    const painter = new RecordingPainter();
    paintScene(painter, { items: [{
      type: "stroke", id: "erase", author: "me", at: 1, ink: "#ffffff", tool: "eraser",
      width: 0.1, points: [[0, 0], [1, 1]],
    }] }, 100, 100);
    expect(painter.globalCompositeOperation).toBe("destination-out");
    expect(painter.calls).toContain("restore");
  });

  it("scatters deterministic spray dots from the stroke id", () => {
    const scene = (id: string): Scene => ({ items: [{
      type: "stroke", id, author: "me", at: 1, ink: "#ffffff", tool: "spray",
      width: 0.1, points: [[0.1, 0.1], [0.9, 0.9]],
    }] });
    const first = new RecordingPainter();
    const second = new RecordingPainter();
    const other = new RecordingPainter();
    paintScene(first, scene("same"), 100, 100);
    paintScene(second, scene("same"), 100, 100);
    paintScene(other, scene("other"), 100, 100);
    expect(first.calls).toEqual(second.calls);
    expect(first.calls).not.toEqual(other.calls);
  });
});
