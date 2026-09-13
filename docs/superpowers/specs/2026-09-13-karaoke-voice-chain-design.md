# Karaoke voice chain — design

## Problems

1. **The listener sends the singer's voice back to her.** On speakers, echo cancellation leaves a faint residual of the other person. The singing stage ran it through a `DynamicsCompressorNode`, and that node silently adds its own automatic makeup gain: 5.3 dB at threshold -30, knee 24 and ratio 2.5. This was verified against Chromium's `dynamics_compressor.cc` and reproduced numerically. Stacked on the explicit +4 dB, the residual was lifted **+9.3 dB**, more than the voice itself. The "noisy room" profile hid the problem, because its noise suppressor removed the residual before the compressor could lift it.
2. **High notes are muffled in a noisy room.** The browser's noise suppressor is tuned for speech, so it treats a held note as steady noise and turns it down. On speakers, WebRTC's echo suppressor also sets the band above 8 kHz to the lowest gain applied to any band below it, so suppressing the song dulls the top of the voice as well.
3. **Loud notes clip on headphones in a quiet room.** The same stage lifted by up to +15 dB, which put a loud note above full scale.

## Behaviour

| Mode | Browser processing | Our chain (`VOICE_STYLES`) |
|---|---|---|
| Headphones, quiet (`open`) | AEC, NS, AGC and voice isolation all off | +8 dB makeup; a 3:1 compressor from -20 dBFS brings the gain to 0 dB at -8 dBFS; limiter at -1 dBFS |
| Speakers, quiet (`open-speakers`) | AEC on; NS, AGC and voice isolation off | Gate (-46 dBFS, 20 dB range) removes the echo residual between phrases; **no gain**; limiter |
| Headphones, noisy (`clean`) | NS off | 90 Hz high-pass, +3 dB presence at 3 kHz, gate (-40 dBFS, 18 dB range), 2.5:1 compressor at -24 dBFS, +8 dB makeup, limiter |
| Speakers, noisy (`clean-speakers`) | AEC on; NS off | 90 Hz high-pass, the same gate and compressor, **no presence peak and no gain**; limiter |

Every stage changes level only, never tone, except the fixed filters. Nothing lifts quiet sound when nobody is singing.

**Rule learned the hard way (fix after `65e4471`):** on speakers the chain adds no gain at all. Two people on speakers form a loop, and echo cancellation is the only thing keeping that loop below unity; gain here is added once per side. The first version gave speakers +6 dB at every level, and a loop that had been an echo climbed to the limiter as a constant loud tone. On every style, a loud input is never lifted, so an unexpected loop settles instead of running to full scale. `voiceDynamics.test.ts` simulates the two-device loop.

**Known limit:** on speakers, echo cancellation still dulls the top of the voice while the song is loud. Headphones are the cure.

## Structure

| File | Role |
|---|---|
| `src/lib/media/voiceStyles.ts` | The contract: styles, settings, `voiceStyle(mode, noisy)` |
| `public/worklets/voice-dynamics.js` | AudioWorklet with the gate, compressor, makeup gain and limiter. Also exports `createVoiceDynamics` for tests. |
| `src/lib/media/voiceChain.ts` | Builds the graph: source → filters → worklet → destination. Falls back to filters only, with no gain, if the worklet can't load. |
| `src/lib/media/micProfile.ts` | Noise suppression is off in every singing profile |
| `src/lib/media/useMicProfile.ts` | Uses `buildVoiceChain`. The profile key includes the style, so toggling the noisy switch rebuilds the chain. |

`micGain.ts` is deleted.

## Testing

**Worklet tests** check that:
- a -55 dBFS residual is never lifted
- no output sample exceeds -1 dBFS, even for a +6 dBFS input
- the gate opens within 5 ms of a sung onset
- a held note varies by less than 1 dB
- a 6 kHz tone gets the same gain as a 300 Hz tone

**Chain tests** check node order and the fallback when the worklet can't load.

**Hook tests** check that the chain is rebuilt when the noisy switch changes.

A live test by both singers is still needed.
