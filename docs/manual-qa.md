# Manual QA — v1

ICE negotiation cannot be meaningfully unit-tested, so these run by hand against
the deployed URL. Use two machines on different networks; putting one on mobile
tethering is what exercises the relay path realistically.

`localhost` is a secure context only on the machine serving it, so cross-machine
testing needs the deployed URL.

## Connection

- [ ] Cold connect: both open `/room/<code>`, video and audio flow both ways
- [ ] Status shows a round-trip figure consistent with the physical distance
      (expect 180–220ms Asia ↔ US/EU — that is the floor, not a bug)
- [ ] Refresh one side: the session re-establishes without touching the other
- [ ] Both open the link within the same second: exactly one offer is made and
      the call connects (glare tiebreak)
- [ ] Force relay by tethering one peer to mobile data: status says "via relay"
- [ ] Kill wifi mid-call for ~10s: status goes to reconnecting, then recovers

## Media

- [ ] Deny camera on one side: that side still hears and sees the partner, the
      tile explains why it is empty, and the page does not look broken
- [ ] Local tile is mirrored; remote tile is not
- [ ] No audio feedback howl (the local tile must be muted)

## Gestures

- [ ] Each of heart, peace, thumbs up, smile fires within about a second of
      holding it
- [ ] Holding a gesture for 10s fires it once, not repeatedly
- [ ] Repeating a gesture immediately does not re-fire inside the 3s cooldown
- [ ] A meme appears over the correct person's tile on BOTH screens
- [ ] Both screens show the meme at visibly the same moment — this is the whole
      point of SyncedClock, so watch the two laptops side by side
- [ ] With gestures blocked on one side, that side still receives the other's

## History

- [ ] After a session ends, it appears on `/` with a plausible duration
- [ ] Reaction totals roughly match what was triggered
- [ ] Meme counts are written once at session end, not per gesture — check for
      exactly one UPDATE per session against `sessions`
- [ ] Close the tab rather than navigating away: the session still closes
      (this is the `sendBeacon` path, and it is the common case)
- [ ] `select count(*) from signals` stays small — handshake rows are swept

## Appearance

- [ ] Letterbox bars carry all the chrome; nothing overlays the video
- [ ] `M + K` is present on both the homepage and the call page
- [ ] Text is legible against the twilight ground at a glance
- [ ] With reduced motion enabled in the OS, the bars and stars hold still
- [ ] Narrow window: tiles stack, nothing overflows horizontally
