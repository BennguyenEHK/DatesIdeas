import { describe, expect, it } from "vitest";
import { bedrockJoinUrl, formatAddress, parseServerAddress } from "./minecraft";

describe("parseServerAddress", () => {
  it("accepts bare hosts and explicit ports", () => {
    expect(parseServerAddress(" play.example.com ")).toEqual({ host: "play.example.com", port: 25565 });
    expect(parseServerAddress("192.168.1.8:25566")).toEqual({ host: "192.168.1.8", port: 25566 });
  });
  it("rejects malformed or unsafe addresses", () => {
    for (const value of ["", "http://host", "host/path", "host name", "host:0", "host:65536", "999.1.1.1", "[::1]"]) expect(parseServerAddress(value)).toBeNull();
  });
  it("formats Java and Bedrock addresses", () => {
    expect(formatAddress("play.example.com", 25565)).toBe("play.example.com");
    expect(bedrockJoinUrl("Ben & Kim", "host", 25565)).toBe("minecraft://?addExternalServer=Ben%20%26%20Kim|host:25565");
  });
});
