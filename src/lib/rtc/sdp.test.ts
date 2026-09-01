import { describe, it, expect } from "vitest";
import { preferMusicAudio } from "./sdp";

const CRLF = "\r\n";

/** A minimal but realistic audio section, as Chrome writes it. */
function sdpWith(lines: string[]): string {
  return [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8",
    "c=IN IP4 0.0.0.0",
    ...lines,
  ].join(CRLF);
}

const params = (sdp: string) => {
  const m = /^a=fmtp:111 (.*)$/m.exec(sdp);
  return new Map(
    (m?.[1] ?? "").split(";").filter(Boolean).map((p) => {
      const eq = p.indexOf("=");
      return eq === -1 ? [p, ""] : [p.slice(0, eq), p.slice(eq + 1)];
    }),
  );
};

describe("preferMusicAudio", () => {
  it("raises the bitrate and turns on stereo", () => {
    const out = preferMusicAudio(
      sdpWith(["a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1"]),
    );
    const p = params(out);
    expect(p.get("stereo")).toBe("1");
    expect(p.get("sprop-stereo")).toBe("1");
    expect(p.get("maxaveragebitrate")).toBe("128000");
  });

  it("turns off discontinuous transmission", () => {
    // DTX stops sending during perceived silence, which gates a held note.
    const out = preferMusicAudio(
      sdpWith(["a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;usedtx=1"]),
    );
    expect(params(out).get("usedtx")).toBe("0");
  });

  it("keeps parameters the browser negotiated for itself", () => {
    // Replacing the line instead of merging would silently drop these.
    const out = preferMusicAudio(
      sdpWith([
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 minptime=10;cbr=0;maxplaybackrate=48000",
      ]),
    );
    const p = params(out);
    expect(p.get("minptime")).toBe("10");
    expect(p.get("cbr")).toBe("0");
    expect(p.get("maxplaybackrate")).toBe("48000");
  });

  it("overrides a conflicting value rather than appending a second one", () => {
    const out = preferMusicAudio(
      sdpWith(["a=rtpmap:111 opus/48000/2", "a=fmtp:111 stereo=0;usedtx=1"]),
    );
    const line = /^a=fmtp:111 (.*)$/m.exec(out)?.[1] ?? "";
    expect(params(out).get("stereo")).toBe("1");
    // A duplicated key is undefined behaviour; there must be exactly one.
    expect(line.match(/stereo=/g)).toHaveLength(2); // stereo= and sprop-stereo=
    expect(line.match(/(^|;)stereo=/g)).toHaveLength(1);
  });

  it("adds a parameter line when Opus was offered without one", () => {
    const out = preferMusicAudio(sdpWith(["a=rtpmap:111 opus/48000/2"]));
    expect(out).toContain("a=fmtp:111 ");
    expect(params(out).get("maxaveragebitrate")).toBe("128000");
  });

  it("inserts its line with the ending the rest of the SDP uses", () => {
    // A stray bare newline in a CRLF SDP is rejected by some stacks outright.
    const out = preferMusicAudio(sdpWith(["a=rtpmap:111 opus/48000/2"]));
    expect(out).toContain("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 ");
  });

  it("uses bare newlines when the SDP does", () => {
    const lf = ["m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2"].join(
      "\n",
    );
    const out = preferMusicAudio(lf);
    expect(out).toContain("a=rtpmap:111 opus/48000/2\na=fmtp:111 ");
    expect(out).not.toContain("\r");
  });

  it("finds Opus whatever payload number it was given", () => {
    const out = preferMusicAudio(
      ["m=audio 9 UDP/TLS/RTP/SAVPF 96", "a=rtpmap:96 opus/48000/2"].join(CRLF),
    );
    expect(out).toContain("a=fmtp:96 ");
    expect(out).toContain("maxaveragebitrate=128000");
  });

  it("leaves an SDP with no Opus completely alone", () => {
    // Never rewrite something we do not understand: a mangled SDP fails the
    // whole call, and a call without music-grade audio is only worse-sounding.
    const sdp = sdpWith(["a=rtpmap:0 PCMU/8000"]);
    expect(preferMusicAudio(sdp)).toBe(sdp);
  });

  it("does not touch the video section", () => {
    const sdp = [
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 VP8/90000",
      "a=fmtp:96 x-google-start-bitrate=1000",
    ].join(CRLF);
    const out = preferMusicAudio(sdp);
    expect(out).toContain("a=fmtp:96 x-google-start-bitrate=1000");
    expect(out).toContain("a=rtpmap:96 VP8/90000");
  });

  it("is stable when applied twice", () => {
    // An ICE restart re-offers; running over its own output must not stack
    // duplicate parameters.
    const once = preferMusicAudio(
      sdpWith(["a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10"]),
    );
    expect(preferMusicAudio(once)).toBe(once);
  });
});
