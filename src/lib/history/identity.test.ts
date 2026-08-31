import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdentity,
  getDisplayName,
  setDisplayName,
  getSavedRoom,
  saveRoom,
} from "./identity";

beforeEach(() => localStorage.clear());

describe("identity", () => {
  it("returns a stable id across calls", () => {
    const a = getIdentity();
    const b = getIdentity();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("persists the id in localStorage", () => {
    const id = getIdentity();
    expect(localStorage.getItem("datesidea.identity")).toBe(id);
  });

  it("round-trips a display name", () => {
    expect(getDisplayName()).toBeNull();
    setDisplayName("Ben");
    expect(getDisplayName()).toBe("Ben");
  });

  it("round-trips the saved room, upper-cased", () => {
    expect(getSavedRoom()).toBeNull();
    saveRoom("abcdef");
    expect(getSavedRoom()).toBe("ABCDEF");
  });
});
