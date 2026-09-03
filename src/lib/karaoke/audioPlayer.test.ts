import { describe, expect, it, vi } from "vitest";
import {
  createAudioPlayer,
  type ContextLike,
  type GainLike,
  type SourceLike,
} from "./audioPlayer";

/**
 * A compile-time proof that a REAL AudioContext satisfies the narrow interface.
 *
 * Nothing at runtime can check this: jsdom has no Web Audio, so every test below
 * runs against a fake and would pass just as happily if the real thing could
 * never be passed in. The last time narrow interfaces were written for a browser
 * object in this codebase they were subtly un-assignable from it, and only tsc
 * noticed. This line is what makes tsc notice.
 */
const _acceptsRealContext: (context: AudioContext) => ContextLike = (context) => context;
void _acceptsRealContext;

interface FakeSource extends SourceLike {
  started: { when?: number; offset?: number } | null;
  stopped: boolean;
  disconnected: boolean;
}

function fakeContext(): {
  context: ContextLike;
  sources: FakeSource[];
  gain: GainLike;
  advance: (seconds: number) => void;
} {
  let now = 0;
  const sources: FakeSource[] = [];
  const gain: GainLike = {
    gain: { value: 1 },
    connect: () => {},
    disconnect: () => {},
  };

  const context: ContextLike = {
    get currentTime() {
      return now;
    },
    destination: {},
    createGain: () => gain,
    createBufferSource: () => {
      const source: FakeSource = {
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        started: null,
        stopped: false,
        disconnected: false,
        connect: () => {},
        disconnect() {
          source.disconnected = true;
        },
        start(when?: number, offset?: number) {
          source.started = { when, offset };
        },
        stop() {
          source.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
    resume: async () => {},
  };

  return {
    context,
    sources,
    gain,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}

/** Only `duration` is read from the buffer, so a whole AudioBuffer is overkill. */
function track(durationSec: number): AudioBuffer {
  return { duration: durationSec } as unknown as AudioBuffer;
}

function playerWithTrack(durationSec = 200) {
  const harness = fakeContext();
  const player = createAudioPlayer(harness.context);
  player.setTrack(track(durationSec));
  return { ...harness, player };
}

describe("readiness and loading", () => {
  it("is not ready until it has been given a track", () => {
    const { context } = fakeContext();
    const player = createAudioPlayer(context);
    expect(player.isReady()).toBe(false);
    player.setTrack(track(120));
    expect(player.isReady()).toBe(true);
    expect(player.durationSec()).toBe(120);
  });

  it("starts paused, so a track arriving does not blurt out", () => {
    const { player, sources } = playerWithTrack();
    expect(sources).toHaveLength(0);
    expect(player.currentTime()).toBe(0);
  });

  it("takes only the start position from load, never the id", () => {
    // The track was chosen on this machine, exactly as a local film is.
    const { player } = playerWithTrack();
    player.load("whatever-the-peer-called-it", 30);
    expect(player.currentTime()).toBe(30);
  });
});

describe("playing, which needs a new node every time", () => {
  it("builds a fresh source on each play, because a node is single-use", () => {
    const { player, sources } = playerWithTrack();

    player.play();
    player.pause();
    player.play();

    // Reusing a stopped AudioBufferSourceNode produces a player that works
    // exactly once and is then silently mute, which is why this is pinned.
    expect(sources).toHaveLength(2);
    expect(sources[0].stopped).toBe(true);
    expect(sources[1].started).not.toBeNull();
  });

  it("starts the node at the current position, not at zero", () => {
    const { player, sources } = playerWithTrack();
    player.seek(42);
    player.play();
    expect(sources[0].started?.offset).toBe(42);
  });

  it("advances with the context clock while playing", () => {
    const { player, advance } = playerWithTrack();
    player.play();
    advance(5);
    expect(player.currentTime()).toBe(5);
  });

  it("does not advance while paused", () => {
    const { player, advance } = playerWithTrack();
    player.play();
    advance(4);
    player.pause();
    advance(60);
    expect(player.currentTime()).toBe(4);
  });

  it("ignores a second play, rather than stacking two sources", () => {
    const { player, sources } = playerWithTrack();
    player.play();
    player.play();
    expect(sources).toHaveLength(1);
  });
});

describe("changing speed, which is the whole reason this exists", () => {
  it("accepts a rate, unlike every player this app has had before", () => {
    const { player } = playerWithTrack();
    player.play();
    // YouTube's handle answers false here, always. That single difference is
    // what switches on rampPlan and the smooth drift correction behind it.
    expect(player.setRate(1.03)).toBe(true);
  });

  it("changes the live node instead of restarting it", () => {
    const { player, sources } = playerWithTrack();
    player.play();
    player.setRate(0.97);

    expect(sources).toHaveLength(1);
    expect(sources[0].playbackRate.value).toBe(0.97);
    expect(sources[0].stopped).toBe(false);
  });

  it("counts elapsed time at the rate in force, without rewriting history", () => {
    const { player, advance } = playerWithTrack();
    player.play();
    advance(2);
    player.setRate(2);
    advance(2);
    // Two seconds at 1x then two at 2x is six, not eight.
    expect(player.currentTime()).toBe(6);
  });

  it("refuses a nonsense rate rather than lying about it", () => {
    const { player } = playerWithTrack();
    player.play();
    expect(player.setRate(0)).toBe(false);
    expect(player.setRate(Number.NaN)).toBe(false);
    expect(player.setRate(-1)).toBe(false);
  });

  it("refuses a rate when there is no track to apply it to", () => {
    const { context } = fakeContext();
    expect(createAudioPlayer(context).setRate(1.02)).toBe(false);
  });
});

describe("moving the playhead", () => {
  it("restarts the source when seeking mid-playback", () => {
    const { player, sources } = playerWithTrack();
    player.play();
    player.seek(100);
    expect(sources).toHaveLength(2);
    expect(sources[1].started?.offset).toBe(100);
  });

  it("does not start playing because of a seek while paused", () => {
    const { player, sources } = playerWithTrack();
    player.seek(100);
    expect(sources).toHaveLength(0);
    expect(player.currentTime()).toBe(100);
  });

  it("treats nudge exactly as seek, there being no buffer cliff here", () => {
    const { player, sources } = playerWithTrack();
    player.play();
    player.nudge(50);
    expect(sources[1].started?.offset).toBe(50);
  });

  it("clamps a seek past the end of the track", () => {
    const { player } = playerWithTrack(90);
    player.seek(900);
    expect(player.currentTime()).toBe(90);
  });
});

describe("the end of the track", () => {
  it("pauses when the running node reports it has ended", () => {
    const { player, sources, advance } = playerWithTrack();
    player.play();
    advance(3);
    sources[0].onended?.(new Event("ended"));
    advance(60);
    expect(player.currentTime()).toBe(3);
  });

  it("ignores an ended report from a node a seek already replaced", () => {
    const { player, sources, advance } = playerWithTrack();
    player.play();
    player.seek(20);
    // The node the seek discarded fires onended as it stops. Letting that
    // through would pause playback that had just been restarted elsewhere.
    sources[0].onended?.(new Event("ended"));
    advance(5);
    expect(player.currentTime()).toBe(25);
  });
});

describe("volume, which belongs to the listener", () => {
  it("clamps and applies a percentage", () => {
    const { player, gain } = playerWithTrack();
    player.setVolume(50);
    expect(gain.gain.value).toBe(0.5);
    player.setVolume(500);
    expect(gain.gain.value).toBe(1);
    player.setVolume(-20);
    expect(gain.gain.value).toBe(0);
  });

  it("carries a chosen volume onto a track picked afterwards", () => {
    const { player, gain } = playerWithTrack();
    player.setVolume(30);
    player.setTrack(track(60));
    expect(gain.gain.value).toBe(0.3);
  });
});

describe("tearing down", () => {
  it("stops playback when the track is taken away", () => {
    const { player, sources } = playerWithTrack();
    player.play();
    player.setTrack(null);
    expect(sources[0].stopped).toBe(true);
    expect(player.isReady()).toBe(false);
    expect(player.durationSec()).toBe(0);
  });

  it("survives being disposed twice", () => {
    const { player } = playerWithTrack();
    player.play();
    player.dispose();
    expect(() => player.dispose()).not.toThrow();
  });

  it("does not throw when a node refuses to stop", () => {
    const harness = fakeContext();
    const player = createAudioPlayer(harness.context);
    player.setTrack(track(60));
    player.play();
    harness.sources[0].stop = vi.fn(() => {
      throw new Error("never started");
    });
    expect(() => player.pause()).not.toThrow();
  });
});
