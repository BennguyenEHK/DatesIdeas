# M + K

A private video room for exactly two people, built for date nights across a long
distance. Video and audio travel directly between the two browsers — never
through a server. A shared timebase lets both screens act at the same real-world
moment, and hand and face gestures raise reactions on both sides at once.

## What's in v1

- Peer-to-peer video and audio between exactly two people
- A shared clock (`SyncedClock`) both browsers agree on, accurate across an
  intercontinental link
- Four gestures — heart hands, peace, thumbs up, big smile — detected on-device
  and rendered on both screens at the identical instant
- A history of past evenings

Movie sync, the card game, the photo booth, and karaoke are planned as v2–v5.
They are small precisely because v1 builds the clock and the message protocol
properly. See the [design spec](docs/superpowers/specs/2026-08-31-datesidea-foundation-design.md)
and the [implementation plan](docs/superpowers/plans/2026-08-31-datesidea-v1-foundation.md).

## Two people, on purpose

There is no sign-up, no password, and no user table. A six-character room code in
a URL you text each other is the whole authorization story. Nothing about the app
assumes a third participant, and adding one would require redesigning it.

## Latency, honestly

Across an intercontinental link the round trip floor is roughly 180–220ms. That
is fiber and the speed of light, not something code can fix. What the app targets
instead is **one-way media latency of 90–110ms**, which peer-to-peer does reach —
and it hides the rest by scheduling actions on the shared clock rather than
firing them on arrival.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

You need two services, both free to start:

**Supabase** — create a project in a region between the two participants, run
`supabase/migrations/0001_init.sql` in the SQL editor, then copy the project URL
and anon key into `.env.local`.

**Cloudflare Realtime TURN** — create a TURN key in the Cloudflare dashboard and
copy the Key ID and API token in. Without TURN, peers behind symmetric NAT or a
mobile carrier will fail to connect at all; the app tells you when it has fallen
back to plain STUN rather than hiding it.

The `CLOUDFLARE_*` variables must never be given a `NEXT_PUBLIC_` prefix — they
are minted server-side by `/api/turn` and must not reach the browser.

## Testing

```bash
npm test          # unit tests
npx tsc --noEmit  # types
npm run build     # production build
```

The logic-bearing parts — clock offset selection, gesture thresholds and
hysteresis, the glare tiebreak, message decoding — are pure functions and are
covered by unit tests. ICE negotiation cannot be faithfully simulated, so it has
a written checklist instead: [docs/manual-qa.md](docs/manual-qa.md).

## Deploying

Push to Vercel and set the four environment variables in project settings.
`getUserMedia` requires HTTPS, which Vercel provides. Testing across two machines
needs the deployed URL — `localhost` is a secure context only on the machine
serving it.
