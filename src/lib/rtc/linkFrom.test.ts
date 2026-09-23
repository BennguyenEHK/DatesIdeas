import { describe, expect, it } from "vitest";
import type { Topology, TrafficRates } from "./diagnostics";
import { linkFrom } from "./linkFrom";
import { EMPTY_LINK } from "./linkSnapshot";

const topology: Topology = {
  relayed: true,
  localType: "relay",
  remoteType: "srflx",
  localAddress: null,
  remoteAddress: null,
  protocol: "udp",
  relayProtocol: "udp",
  availableOutgoingKbps: 695,
  gathering: {
    types: [],
    hasReflexive: true,
    hasRelay: true,
    relayProtocols: [],
  },
  pairStates: {},
};

const rates: TrafficRates = {
  videoUpKbps: 300,
  videoDownKbps: 300,
  audioUpKbps: 64,
  audioDownKbps: 64,
  audioLossPct: 5.3,
};

describe("linkFrom", () => {
  it("is exactly the empty link before anything has been measured", () => {
    expect(linkFrom(null, null, null, null)).toEqual(EMPTY_LINK);
  });

  it("fills every field from the last poll", () => {
    expect(
      linkFrom(topology, rates, 1813, { jitterMs: 42, lossPct: 4 }),
    ).toEqual({
      outgoingKbps: 695,
      audioJitterMs: 1813,
      audioLossPct: 5.3,
      theirJitterMs: 42,
      theirLossPct: 4,
      relayed: true,
    });
  });

  it("leaves their view null when their browser sent no report", () => {
    const link = linkFrom(topology, rates, 100, null);
    expect(link.theirJitterMs).toBeNull();
    expect(link.theirLossPct).toBeNull();
  });

  it("keeps an unmeasured estimate null rather than unlimited", () => {
    const link = linkFrom(
      { ...topology, availableOutgoingKbps: null },
      null,
      null,
      null,
    );
    expect(link.outgoingKbps).toBeNull();
    expect(link.relayed).toBe(true);
  });
});
