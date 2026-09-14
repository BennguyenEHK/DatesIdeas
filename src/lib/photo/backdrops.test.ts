import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("backdrop loading", () => {
  it("caches one successful image request and exposes it synchronously afterwards", async () => {
    vi.resetModules();
    const made: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
    vi.stubGlobal(
      "Image",
      class {
        crossOrigin = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          made.push(this as unknown as (typeof made)[number]);
          this._src = value;
        }
        get src() {
          return this._src;
        }
        private _src = "";
      },
    );
    const { backdropImage, loadBackdrop } = await import("./backdrops");
    expect(backdropImage("/scene.svg")).toBeNull();
    expect(made).toHaveLength(1);
    made[0].onload?.();
    await expect(loadBackdrop("/scene.svg")).resolves.toBe(made[0]);
    expect(backdropImage("/scene.svg")).toBe(made[0]);
    expect(made).toHaveLength(1);
  });

  it("resolves a failed picture to null instead of rejecting", async () => {
    vi.resetModules();
    const record: { image: { onload: (() => void) | null; onerror: (() => void) | null } | null } = {
      image: null,
    };
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          record.image = this;
        }
      },
    );
    const { loadBackdrop } = await import("./backdrops");
    const pending = loadBackdrop("/broken.svg");
    record.image?.onerror?.();
    await expect(pending).resolves.toBeNull();
  });
});
