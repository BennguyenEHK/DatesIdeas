"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioMode } from "@/lib/media/micProfile";

const headphoneWords =
  /\b(?:headphones?|headset|earphones?|earbuds?|earpieces?|airpods?|buds|hands[- ]?free)\b/i;
const speakerWords =
  /\b(?:speakers?|internal|built[- ]?in|hdmi|display|monitors?|tv|soundbars?|docks?)\b/i;

/**
 * Identifies the listening device from the useful words in its browser label.
 * Headphones win mixed labels because disabling echo cancellation on a headset
 * is safe, while treating a headset as speakers only leaves some quality on.
 */
export function classifyOutput(label: string): AudioMode | null {
  if (label.trim() === "") return null;
  if (headphoneWords.test(label)) return "headphones";
  if (speakerWords.test(label)) return "speakers";
  return null;
}

/**
 * Chooses the output that answers where the operating system is routing sound.
 * Chrome's default entry mirrors that route, so another labelled device must
 * not override it when both are present.
 */
export function detectOutput(
  devices: readonly MediaDeviceInfo[],
): AudioMode | null {
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const defaultOutput = outputs.find((device) => device.deviceId === "default");
  const defaultMode = defaultOutput
    ? classifyOutput(defaultOutput.label)
    : null;
  if (defaultMode !== null) return defaultMode;

  for (const device of outputs) {
    const mode = classifyOutput(device.label);
    if (mode !== null) return mode;
  }
  return null;
}

/**
 * Watches the browser's output-device list while automatic detection is on.
 * A missing or rejecting Web API is normal on insecure contexts and Safari,
 * so it must leave the safe speaker answer in place without breaking karaoke.
 */
export function useOutputMode(enabled: boolean): {
  mode: AudioMode;
  auto: boolean;
  choose: (m: AudioMode) => void;
} {
  const [mode, setMode] = useState<AudioMode>("speakers");
  const [auto, setAuto] = useState(true);
  const manual = useRef(false);

  const choose = (selected: AudioMode) => {
    manual.current = true;
    setAuto(false);
    setMode(selected);
  };

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let mediaDevices: MediaDevices | undefined;
    try {
      mediaDevices =
        typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    } catch {
      mediaDevices = undefined;
    }

    if (
      !mediaDevices ||
      typeof mediaDevices.enumerateDevices !== "function"
    ) {
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      void mediaDevices
        ?.enumerateDevices()
        .then((devices) => {
          if (active && !manual.current) {
            const detected = detectOutput(devices);
            if (detected !== null) setMode(detected);
          }
        })
        .catch(() => {});
    };

    refresh();
    try {
      if (typeof mediaDevices.addEventListener === "function") {
        mediaDevices.addEventListener("devicechange", refresh);
      }
    } catch {
      // Some older implementations expose the object but reject event setup.
    }

    return () => {
      active = false;
      try {
        if (typeof mediaDevices?.removeEventListener === "function") {
          mediaDevices.removeEventListener("devicechange", refresh);
        }
      } catch {
        // Cleanup is best effort because older implementations may be partial.
      }
    };
  }, [enabled]);

  return { mode, auto, choose };
}
