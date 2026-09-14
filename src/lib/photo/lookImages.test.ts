import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("look layer loading", () => {
  it("uses anonymous image loading and returns a settled image", async () => {
    vi.resetModules();
    const record: { image: { crossOrigin: string; onload: (() => void) | null } | null } = { image: null };
    vi.stubGlobal(
      "Image",
      class {
        crossOrigin = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          record.image = this;
        }
      },
    );
    const { loadLookImage, lookImage } = await import("./lookImages");
    const pending = loadLookImage("https://looks.test/paper.png");
    expect(record.image?.crossOrigin).toBe("anonymous");
    record.image?.onload?.();
    await expect(pending).resolves.toBe(record.image);
    expect(lookImage("https://looks.test/paper.png")).toBe(record.image);
  });
});
