import { describe, expect, it } from "vitest";

import {
  CHUNK_BYTES,
  HIGH_WATER_BYTES,
  chunkCount,
  chunkTrack,
  createAssembler,
  shouldPause,
} from "./fileChannel";

function randomBuffer(byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

function bufferOf(byteLength: number): ArrayBuffer {
  return new ArrayBuffer(byteLength);
}

function reassemble(bytes: ArrayBuffer) {
  const chunks = chunkTrack(bytes);
  const assembler = createAssembler(chunks.length, bytes.byteLength);
  for (const chunk of chunks) assembler.push(chunk);
  return assembler.state;
}

describe("file channel chunks", () => {
  it("round-trips random bytes exactly", () => {
    const source = randomBuffer(40_000);
    const state = reassemble(source);

    expect(state.status).toBe("complete");
    if (state.status !== "complete") return;
    expect([...new Uint8Array(state.bytes)]).toEqual([...new Uint8Array(source)]);
  });

  it("does not add an empty chunk for an exact multiple", () => {
    const source = randomBuffer(CHUNK_BYTES * 2);
    const chunks = chunkTrack(source);
    const state = reassemble(source);

    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.byteLength === CHUNK_BYTES)).toBe(true);
    expect(state.status).toBe("complete");
    if (state.status !== "complete") return;
    expect([...new Uint8Array(state.bytes)]).toEqual([...new Uint8Array(source)]);
  });

  it("accepts a short final chunk", () => {
    const source = bufferOf(CHUNK_BYTES + 7);
    const chunks = chunkTrack(source);
    const assembler = createAssembler(chunks.length, source.byteLength);

    for (const chunk of chunks) assembler.push(chunk);

    expect(chunks.at(-1)?.byteLength).toBe(7);
    expect(assembler.state.status).toBe("complete");
  });

  it.each([0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, CHUNK_BYTES * 37 + 9])(
    "counts %i bytes exactly as chunkTrack does",
    (byteLength) => {
      expect(chunkCount(byteLength)).toBe(chunkTrack(bufferOf(byteLength)).length);
    },
  );
});

describe("file channel assembler", () => {
  it("stays receiving when a chunk is missing", () => {
    const source = bufferOf(CHUNK_BYTES * 2 + 1);
    const chunks = chunkTrack(source);
    const assembler = createAssembler(chunks.length, source.byteLength);

    assembler.push(chunks[0]);
    assembler.push(chunks[1]);

    expect(assembler.state).toMatchObject({ status: "receiving", receivedChunks: 2 });
  });

  it("rejects a chunk after the declared count", () => {
    const assembler = createAssembler(0, 0);

    expect(assembler.push(bufferOf(1))).toEqual({
      status: "failed",
      reason: "too-many-chunks",
    });
  });

  it("rejects an oversized transfer", () => {
    const assembler = createAssembler(2, 3);

    expect(assembler.push(bufferOf(4))).toEqual({ status: "failed", reason: "too-many-bytes" });
  });

  it("rejects the declared count when its bytes do not match", () => {
    const assembler = createAssembler(2, 3);

    assembler.push(bufferOf(1));
    expect(assembler.push(bufferOf(1))).toEqual({ status: "failed", reason: "size-mismatch" });
  });

  it("reports progress without decreasing received bytes", () => {
    const assembler = createAssembler(3, 6);
    const progress = [
      assembler.state,
      assembler.push(bufferOf(1)),
      assembler.push(bufferOf(2)),
      assembler.push(bufferOf(3)),
    ]
      .filter((state) => state.status === "receiving")
      .map((state) => state.receivedBytes);

    expect(progress).toEqual([0, 1, 3]);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("keeps its terminal state when pushed again", () => {
    const assembler = createAssembler(1, 1);
    const complete = assembler.push(bufferOf(1));

    expect(assembler.push(bufferOf(1))).toBe(complete);
    expect(assembler.state).toBe(complete);
  });
});

describe("file channel backpressure", () => {
  it("pauses only above the high-water mark", () => {
    expect(shouldPause(HIGH_WATER_BYTES)).toBe(false);
    expect(shouldPause(HIGH_WATER_BYTES + 1)).toBe(true);
  });
});
