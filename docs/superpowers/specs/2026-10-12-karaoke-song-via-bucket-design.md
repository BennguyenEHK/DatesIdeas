# Karaoke song through the storage bucket

Date: 2026-10-12. Status: approved by the owner in conversation.

## Problem
A karaoke song is a 360p MP4 of up to 60 MB (helper/extract.mjs). It is pushed
peer-to-peer over the call's "files" data channel, paced to 30% of the upload
estimate and held completely whenever the other side reports voice loss > 3%.
On K's lossy Wi-Fi it is held almost all the time: 7% -> 10% in three minutes.
A file-channel drop mid-song also throws the whole transfer away.

## Goal
The song reaches the other person as fast as possible without breaking the call.

## Flow (unchanged up to step 2)
1. Paste a YouTube link; the helper downloads the MP4 on the computer running it.
2. The browser has the bytes and can play at once (as today).
3. NEW: the browser asks `POST /api/karaoke/track` for a slot, uploads the file
   to `karaoke/<ROOM>/<token>.mp4`, and sends `track-progress` while it does.
4. NEW: it sends `track-url` with the signed download link.
5. NEW: the receiver downloads it in 4 parallel ranged parts, each resuming from
   where it stopped, then adopts it exactly as an arrived track today, and sends
   `track-ready` (unchanged).
6. Any failure in 3-5 falls back to the peer-to-peer path (below). A receiver
   that cannot fetch the URL sends `track-url-failed`; the sender then sends
   peer-to-peer. A peer on an older build ignores track-url and still gets the
   song only if the sender falls back -- acceptable: both of us update together.

## Peer-to-peer fallback, improved
- Never stop on loss alone: `shouldHold` holds only on jitter (> 400 ms, a queue
  building up). Loss alone keeps the song going at its paced rate.
- While the camera is held (below), the song's share of the upload estimate is
  0.7 instead of 0.3 (`LinkSnapshot.cameraPaused`).
- Resume after a rebuild: if the file channel closes mid-song, the sender waits
  up to 60 s for it to reopen instead of giving up; the receiver keeps its
  partial assembly and, once the channel is open again, sends
  `track-resume { fromChunk }` = the number of chunks it holds in order; the
  sender continues from that chunk. No answer within 10 s of reopening: start
  again from chunk 0 with a fresh `track-meta`.

## Camera held while sending
The sending side holds its camera off (encoding.active = false; voice stays on)
for the whole send -- upload or peer-to-peer -- and releases it when the send
ends, however it ends. `holdCamera(on)` on usePeerConnection; while held, every
leash application keeps the camera paused; release re-applies the normal leash.

## Server
- `POST /api/karaoke/track` body `{ code, bytes, contentType }`.
  - code must be a valid room code of a room that exists and has not expired
    (same check as /api/keepsake). bytes integer 1..60 MiB. contentType exactly
    "video/mp4".
  - 200 `{ uploadUrl, downloadUrl, key }` via presignKeepsake; 400 bad input;
    404 room unknown/expired; 503 storage not configured or signing failed.
- Keys: `karaoke/<ROOM>/<32 lowercase hex>.mp4` (src/lib/karaoke/keys.ts).
- Cleanup (src/lib/storage/cleanup.ts): delete `karaoke/` objects whose room is
  no longer open, or whose lastModified is more than 24 h old. `mayDelete`
  accepts only well-formed karaoke keys. Report `karaokeFilesDeleted`.
- The bucket's CORS already allows PUT and GET with Range from any origin
  (verified with preflights on 2026-10-12). No manual bucket setup.

## Progress shown to the receiver
`incoming = { receivedBytes, expectedBytes: bytes }` where receivedBytes is
`sentBytes / 2` during upload and `bytes / 2 + downloaded / 2` during download,
so one bar runs 0 -> 100% monotonically. Peer-to-peer keeps today's meaning.

## Interfaces (the contract between work units)
- protocol.ts (done): `track-progress {requestId, sentBytes, bytes}`,
  `track-url {requestId, url, title, durationSec, bytes}`,
  `track-url-failed {requestId}`, `track-resume {requestId, fromChunk}`.
  RoomClient already routes them to `transfer.handleMessage`.
- bucketTransfer.ts (stub in place): `requestTrackSlot`, `uploadTrack`,
  `downloadTrack` with the signatures in the file.
- usePeerConnection: `holdCamera(on: boolean): void` in the returned object;
  `readLink()` sets `cameraPaused`.
- useTrackTransfer args gain `roomCode: string`, `holdCamera?: (on: boolean) => void`,
  `bucket?: { requestTrackSlot, uploadTrack, downloadTrack }` (defaults to the
  real module, injectable for tests).

## Out of scope
Multipart parallel upload (only matters if K is the sender), deleting the file
the moment both have it, any change to the helper.

## Testing
Unit tests per unit (named for behaviour). Then a two-browser run on a prod
build with a real MP4 through the bucket, and one with storage disabled to prove
the fallback.
