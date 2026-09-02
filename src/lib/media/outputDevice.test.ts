import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { classifyOutput, detectOutput, useOutputMode } from "./outputDevice";

function device(
  kind: MediaDeviceKind,
  label: string,
  deviceId = label,
): MediaDeviceInfo {
  return { deviceId, groupId: "group", kind, label, toJSON: () => ({}) };
}

describe("classifyOutput", () => {
  it.each([
    ["Default - Headphones (Realtek(R) Audio)", "headphones"],
    ["AirPods Pro de John's MacBook", "headphones"],
    ["USB Hands-Free Headset", "headphones"],
    ["Speakers (2- USB Audio Device)", "speakers"],
    ["MacBook Pro Speakers", "speakers"],
    ["DELL U2720Q HDMI / Display", "speakers"],
  ])("classifies %s", (label, expected) => {
    expect(classifyOutput(label)).toBe(expected);
  });

  it("lets headphone evidence win when a driver label contains both kinds", () => {
    expect(classifyOutput("Headset Speakers (USB Audio)")).toBe("headphones");
  });

  it("returns null for empty and unhelpful labels", () => {
    expect(classifyOutput("")).toBeNull();
    expect(classifyOutput("USB Audio Device")).toBeNull();
  });
});

describe("detectOutput", () => {
  it("prefers a classifiable default output", () => {
    expect(
      detectOutput([
        device("audiooutput", "USB Headphones"),
        device("audiooutput", "Speakers", "default"),
      ]),
    ).toBe("speakers");
  });

  it("falls back to the first classifiable output and otherwise returns null", () => {
    expect(
      detectOutput([
        device("audioinput", "Internal Microphone"),
        device("audiooutput", "Unknown USB Audio"),
        device("audiooutput", "Earbuds"),
      ]),
    ).toBe("headphones");
    expect(detectOutput([device("audioinput", "Internal Microphone")])).toBeNull();
  });
});

describe("useOutputMode", () => {
  it("latches a manual override against later detection", async () => {
    const enumerateDevices = vi.fn(() =>
      Promise.resolve([device("audiooutput", "Headphones", "default")]),
    );
    const mediaDevices = { enumerateDevices } as unknown as MediaDevices;
    vi.stubGlobal("navigator", { mediaDevices });
    const { result } = renderHook(() => useOutputMode(true));

    await waitFor(() => expect(result.current.mode).toBe("headphones"));
    act(() => result.current.choose("speakers"));
    expect(result.current).toMatchObject({ mode: "speakers", auto: false });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.mode).toBe("speakers");
    vi.unstubAllGlobals();
  });

  it("keeps the safe default when mediaDevices is absent", () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useOutputMode(true));
    expect(result.current).toMatchObject({ mode: "speakers", auto: true });
    vi.unstubAllGlobals();
  });
});
