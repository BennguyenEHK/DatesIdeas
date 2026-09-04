/** Keeps each SCTP message comfortably below common implementation limits. */
export const CHUNK_BYTES = 16 * 1024;

/** Stops the sender from building an unbounded data-channel queue. */
export const HIGH_WATER_BYTES = 1024 * 1024;

export type AssemblerFailure = "too-many-chunks" | "too-many-bytes" | "size-mismatch";

export type AssemblerState =
  | {
      status: "receiving";
      receivedBytes: number;
      expectedBytes: number;
      receivedChunks: number;
      expectedChunks: number;
    }
  | { status: "complete"; bytes: ArrayBuffer }
  | { status: "failed"; reason: AssemblerFailure };

export interface Assembler {
  push(chunk: ArrayBuffer): AssemblerState;
  readonly state: AssemblerState;
}

function nonNegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Returns the number of messages needed to carry a byte length. */
export function chunkCount(byteLength: number): number {
  const safeByteLength = nonNegativeInteger(byteLength);
  return Math.ceil(safeByteLength / CHUNK_BYTES);
}

/** Copies an audio payload into independently sendable data-channel messages. */
export function chunkTrack(bytes: ArrayBuffer): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)));
  }
  return chunks;
}

function receivingState(
  receivedBytes: number,
  expectedBytes: number,
  receivedChunks: number,
  expectedChunks: number,
): AssemblerState {
  return {
    status: "receiving",
    receivedBytes,
    expectedBytes,
    receivedChunks,
    expectedChunks,
  };
}

function combined(chunks: readonly ArrayBuffer[], byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/**
 * Reassembles a declared, ordered transfer while rejecting inconsistent metadata.
 *
 * A 0 / 0 transfer remains receiving because no received buffer exists to own as
 * its result. This also makes an unexpected first chunk unambiguously an overrun.
 */
export function createAssembler(expectedChunks: number, expectedBytes: number): Assembler {
  const safeExpectedChunks = nonNegativeInteger(expectedChunks);
  const safeExpectedBytes = nonNegativeInteger(expectedBytes);
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  let state: AssemblerState = receivingState(
    receivedBytes,
    safeExpectedBytes,
    chunks.length,
    safeExpectedChunks,
  );

  return {
    push(chunk: ArrayBuffer): AssemblerState {
      if (state.status !== "receiving") return state;

      if (chunks.length >= safeExpectedChunks) {
        state = { status: "failed", reason: "too-many-chunks" };
        return state;
      }

      const nextBytes = receivedBytes + chunk.byteLength;
      if (nextBytes > safeExpectedBytes) {
        state = { status: "failed", reason: "too-many-bytes" };
        return state;
      }

      chunks.push(chunk);
      receivedBytes = nextBytes;
      if (chunks.length === safeExpectedChunks) {
        state = receivedBytes === safeExpectedBytes
          ? { status: "complete", bytes: combined(chunks, receivedBytes) }
          : { status: "failed", reason: "size-mismatch" };
        return state;
      }

      state = receivingState(
        receivedBytes,
        safeExpectedBytes,
        chunks.length,
        safeExpectedChunks,
      );
      return state;
    },
    get state(): AssemblerState {
      return state;
    },
  };
}

/** The low-water event resumes only after this stricter threshold was crossed. */
export function shouldPause(bufferedAmount: number): boolean {
  return bufferedAmount > HIGH_WATER_BYTES;
}
