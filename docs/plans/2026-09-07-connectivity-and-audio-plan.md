# Implementation order — connectivity, microphone, and the two new modes

Written 2026-09-07. Ordered first-to-last. Each phase is shippable on its own;
nothing below a line may start before everything above it is green.

## The constraint everything else is designed around

St Paul, Minnesota <-> Surabaya, Indonesia. ~14,700 km great-circle; realistic
routed path 18-20,000 km. **RTT floor is 200-230 ms and no change in this repo
can lower it.** Measured 266 ms is within ~20% of physics, and the Cloudflare
relay is *helping* (16 ms to the local PoP, private backbone across the Pacific)
rather than hurting.

So the goal is never latency. The goal is **stability at a fixed 250 ms**:
- audio jitter that stays in a band instead of swinging 77 ms -> 1109 ms
- video that holds one resolution instead of oscillating 540p <-> 360p
- and every feature designed to be pleasant *at* 250 ms, not to fight it

---

## Phase A — Connectivity (first; everything else inherits it)

- [x] **A1** Surface the dropped `degraded` flag.
      Produced in `api/turn/route.ts` (x3) and `iceServers.ts` (x2); read
      nowhere. `usePeerConnection.ts` destructures `{ iceServers }` and discards
      it. Expose it, show it in `ConnectionStatus`, include it in the report.
- [x] **A2** Path-aware video leash.
      Today `videoLeash.ts` is a binary keyed on karaoke, so cards and movie run
      `FULL_VIDEO` at 2.5 Mbps. Derive the budget from activity *and* route; cap
      hard when `path.relayed`, harder when `relayProtocol === "tcp"`.
      Re-apply on **path change**, not only on reconnect.
- [x] **A3** Let audio win the link.
      `networkPriority: "high"` on audio, `"low"` on video,
      `degradationPreference: "maintain-resolution"` so video sheds framerate
      rather than collapsing resolution.
- [x] **A4** Adaptive `jitterBufferTarget`, replacing the unconditional `0`.
      `shortenJitterBuffer()` asks for a zero-length buffer on every receiver.
      On a 250 ms TCP-relayed path that is the cause of the 14x jitter swing:
      underrun -> panic -> balloon -> drain -> underrun. Derive a floor from the
      measured path (near-zero when direct and fast; 150-200 ms when relayed and
      RTT > 150 ms), split by track and by activity.
- [x] **A5** Close the report's blind spots.
      Two samples read `Route: unknown` on a live call (`selectPath` returned
      null) and two read `Activity: unknown`. Add: which ICE list was used and
      whether it was degraded, and whether a UDP relay candidate was ever
      *gathered* rather than merely selected.
- [x] **A6** DONE. Capture one fresh report and confirm the jitter band narrowed.
      This is the acceptance test for the whole phase.
      **OWNER: Ben, not Claude.** It needs a real call with K and cannot be
      faked from here. Press the report button a few times mid-call and paste
      the results back. Two things to read: whether audio jitter now sits in a
      band instead of swinging, and what `Relay transports gathered:` says --
      that line is what finally settles whether a UDP relay was ever offered on
      this route or never appeared at all.

**Status 2026-09-07: A1-A5 implemented and green.** 1183 tests across 76 files,
clean tsc, clean eslint. Not committed.

**Explicitly not doing:** TURN on port 53 (probed — Cloudflare does not answer
there), and any workaround premised on UDP being blocked (probed — it is not
blocked from St Paul; STUN answers in 16 ms).

---

## Phase B — Microphone input chain (depends on A4 landing)

Root cause is not yet confirmed; B1 is a diagnosis step, not an assumption.

- [x] **B1a** Make the answer observable. DONE 2026-09-07.
      Investigation found that the microphone's actual state was never read
      ANYWHERE in the app: `getSettings()` appeared in no file, and
      `micProfile.ts` swallowed every `applyConstraints` failure by design. The
      profile was requested and never verified, so "tuned perfectly" and "never
      tuned at all" were the same silent code path. Now shipped:
      - `micState.ts` reads back what the device settled on and names any
        requested processing flag it refused (`unmetRequests`).
      - `inputLevel.ts` folds the RMS the singing detector already computed
        into a running picture: peak, clipping, and *dropouts* -- a clear voice
        collapsing straight to silence between two samples.
      - `tuneMicrophone` returns that evidence instead of discarding it.
      - The pasteable report gained a MICROPHONE block and three notes.

- [x] **B1b** DONE. OWNER: Ben. Sing the songs that break it, then paste the report.
      The measurement is taken from the raw MediaStream through Web Audio,
      which sits AFTER all capture processing and BEFORE the encoder. That
      single vantage point splits the problem in half:
      - `dropouts` > 0 -> the signal was already gone at capture. The codec,
        the relay and the network are all ruled out, and the cause is one of
        the three hypotheses below.
      - `dropouts` == 0 but K still hears nothing -> capture was fine and the
        fault is downstream, which is a completely different investigation.
      The `Requested but refused:` line and the voice-isolation note then
      choose between the remaining hypotheses directly.

- [x] **B1c** CONFIRMED 2026-09-07 from real reports. **Hypothesis 1 was right.**
      Every karaoke report says, in the app's own words:
          Settled as: aec on, ns on, agc on, stereo, 48000Hz
          Requested but refused: noiseSuppression, autoGainControl
      `applyConstraints` cannot switch off noise suppression or automatic gain
      on a live track. The singing profile has NEVER applied. Karaoke has always
      run the microphone processing built for speech -- and noise suppression is
      built to remove a sustained tone, which is exactly what a held note is.
      The same reports show 1 to 7 dropouts, measured before the encoder, so the
      signal was already gone at capture. Codec and network are ruled out.
      The original ranked hypotheses, kept for the record:
      1. `applyConstraints` silently fails to change audio processing on a live
         track (`micProfile.ts` swallows every failure by design), so the
         headphone profile has never actually applied and singing has always
         gone through full speech processing.
      2. OS-level voice isolation (Windows Studio Effects) gating sustained
         notes below the browser. Nothing sets `voiceIsolation: false`.
      3. Input clipping on loud high notes, which AEC/NS then classify as noise.
**Separate defect found during B1, deliberately NOT fixed yet.**
`applyConstraints` replaces a track's whole constraint set, and none of the
singing profiles carry `channelCount`. So the `channelCount: 2` that
`getUserMedia` asks for is silently dropped the moment karaoke first tunes the
microphone -- the stereo request is discarded by the very call meant to improve
singing. It is real and provable from the spec, but it is a DIFFERENT bug from
the dropout, and folding it in now would muddy the one measurement B1b exists to
take. Fix it after B1c, on its own.

- [ ] **B2** Own the input chain: re-acquire the mic with all processing off
      rather than trying to turn it off afterwards.
- [ ] **B3** Web Audio compressor/limiter into a `MediaStreamDestination`, and
      send *that* track. Our limiter, not the browser's AGC.
- [ ] **B4** Visible input meter with a clip indicator, so the failure is
      something you can see instead of something you infer after the evening.
- [ ] **B5** Verify by singing the songs that used to break it.

---

## Phases C, D and E — a standing instruction

**Every phase below is interface work, so invoke the `frontend-design` skill
before writing any of it.** That covers the pillar toggle and the performer
stage in C, the chatbox in D, and the whole dimming treatment in E. It is not
optional polish: this app has an unusually strong and specific visual language
already -- a La La Land twilight palette, a CinemaScope frame where all
interface lives in the letterbox bars and never on the video, and a marquee-bulb
vocabulary running through the activity bar and the question cards. New UI that
ignores that reads as bolted on. Read `src/app/globals.css` top to bottom before
designing anything; the direction is written down there in full.

The one rule that outranks the skill: **nothing new may sit on top of the
video.** The letterbox bars exist precisely so decoration has somewhere to live
that is not the picture.

---

## Phase C — Karaoke live-music mode (depends on B)

Designed around the physics: **one performer, one audience, one direction.**
A 250 ms delay is invisible to a listener — it is a livestream. It only breaks
if both play at once, which is not the feature. This is the one karaoke shape
the route permits.

- [x] **C1** Pillar toggle under the top bar: Karaoke | Live.
      Design via `frontend-design`; match the ActivityBar's lit-bulb language
      rather than inventing a second toggle idiom.
- [x] **C2** Performer's tile takes the karaoke screen size and position; the
      listener's stays put. Shared via a new `PeerMessage`.
- [ ] **C3** BLOCKED ON PHASE B. Performance audio profile: all processing off, `maxaveragebitrate`
      raised to 256k, headphones required, and a **deliberately fat** jitter
      buffer — affordable precisely because nobody is duetting.
- [ ] **C4** Verify with a real instrument.

**Codec answer, settled, so C does not relitigate it:** Opus is correct and
there is no better option in WebRTC. Its algorithmic delay is ~26.5 ms against a
250 ms transport. **Changing codec cannot buy back latency** — do not spend
effort there expecting it to.

---

## Phase D — Movie mode chatbox (independent; parallelisable with E)

- [x] **D1** New `chat` variant in `protocol.ts` with its decoder guard.
- [x] **D2** Chatbox under the two tiles: soft-edged rectangle, light glow on
      hover and focus. Design via `frontend-design`. The glow is explicitly
      "light, not significant" -- closer to the lamp spill already used on the
      TakeoverStage screen than to the pulsing bulb on a selected activity.
- [x] **D3** Gentle send/receive chime, generated in Web Audio rather than
      shipped as an asset, ducked against the film.
- [ ] **D4** Verify it does not steal the link from the film (A3 should hold).

---

## Phase E — Movie mode cinema dimming (independent; smallest)

- [x] **E1** Drive the palette in `globals.css` from a single dim variable.
      Design via `frontend-design`. The target feeling is a cinema house-light
      fade, so the ramp is slow and asymmetric -- down faster than it comes
      back up, the way `duck.ts` already treats its audio fade.
- [x] **E2** Slow ramp down on play, slow rise on pause and on end.
- [x] **E3** Honour `prefers-reduced-motion` — the file already has the pattern.

---

## Ordering rationale

A is first because every other phase inherits its transport, and because B, C,
and D would all be measured against a jitter figure that swings 14x until A4
lands. B is second because it blocks C and is the thing actively ruining
evenings. C is third because it needs B's input chain. D and E are last only
because they are independent — they touch no audio and no WebRTC, so they are
the safe parallel work once A and B are green.


---

## Status 2026-09-07 (second pass)

C1, C2, D1-D3 and E1-E3 implemented and green. 1252 tests across 85 files,
clean tsc, clean eslint. Nothing committed.

Built by three Codex workers on disjoint write sets, each given the same
appended design-system contract so all three extend one visual language.
`protocol.ts` and `RoomClient.tsx` were kept back as the shared spine and wired
by Claude, since all three phases would otherwise have collided in them.

Still owned by Ben: **A6** (call report), **B1b** (sing the high notes),
**C4** (real instrument), **D4** (chat vs film bandwidth).


---

## Evidence from the 2026-09-07 evening (A6 + B1b)

**Connectivity is transformed.** Every report now reads `Route: direct`,
`Candidate types: srflx / srflx`, `Reflexive candidate: yes`,
`Relay transports gathered: tcp, tls, udp`, `TURN credentials: ok`. The earlier
"no reflexive candidate, relayed over TCP" sessions were a property of the
network on that night, not of this app. A1 and A5 are what made this legible.

RTT sits at 247-260 ms, exactly the Pacific floor predicted at the start, with
one 511 ms excursion. It is not going lower and nothing here should try.

Karaoke video holds 640x360 at ~500 kbps: the lean leash is working.

**Open, from the same data:**
- Audio jitter still spikes to 480-1038 ms on a DIRECT route with 0.0% loss.
  A4 asks for a stable 180 ms and is not getting it. Worth a second look.
- Movie and cards video ran at 2427-4583 kbps against a FULL_VIDEO cap of
  2500 kbps. 4583 is 83% over. Either the leash is not landing or the figure
  includes retransmits and probing. Needs checking before trusting the cap.
