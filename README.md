# FestiBooth

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

**Neon (Lakebase Postgres)** — create a project in a region between the two
participants, run `neon/migrations/0001_init.sql` against it, then put the
connection string in `.env.local` as `DATABASE_URL`.

**Cloudflare Realtime TURN** — create a TURN key in the Cloudflare dashboard and
copy the Key ID and API token in. Without TURN, peers behind symmetric NAT or a
mobile carrier will fail to connect at all; the app tells you when it has fallen
back to plain STUN rather than hiding it.

No variable in this app carries a `NEXT_PUBLIC_` prefix, and none should. The
browser never talks to Postgres: `DATABASE_URL` and the Cloudflare credentials
are read only inside route handlers, and `src/lib/db.ts` imports `server-only`
so an accidental client import fails the build instead of leaking a credential.

### How signalling works

Neon is Postgres, not a realtime bus, so the WebRTC handshake runs through a
`signals` table that each peer polls. That sounds slower than it is: the
handshake is about four messages over a few seconds, after which every byte
travels peer-to-peer and polling drops to a slow heartbeat kept only so an ICE
restart can be negotiated if the network drops. Rows are transport, not records
— they are swept 15 minutes after they are written.

## Database

```bash
npm run db:migrate   # apply neon/migrations/*.sql (idempotent, safe to re-run)
npm run db:inspect   # print the live schema
npm run db:status    # row counts and recent sessions
```

## Testing

```bash
npm test          # unit tests
npx tsc --noEmit  # types
npm run build     # production build

npm run dev        # then, in another shell:
npm run test:e2e   # two simulated peers complete a handshake against the real database
npm run turn:check # proves the TURN relay actually allocates, not just that it returns credentials
```

`turn:check` performs a real RFC 5766 Allocate handshake and only passes if
Cloudflare hands back a relayed address — the same thing a browser needs before
it can route a call through the relay. Returning credentials is not proof the
relay works; this is.

`test:e2e` drives the same HTTP routes the browser uses: both peers post a join,
each polls and sees only the other's messages, offer/answer/ICE flow through, the
cursor prevents redelivery, and a session opens, closes, and reads back with its
reaction totals intact.

The logic-bearing parts — clock offset selection, gesture thresholds and
hysteresis, the glare tiebreak, message decoding — are pure functions and are
covered by unit tests. ICE negotiation cannot be faithfully simulated, so it has
a written checklist instead: [docs/manual-qa.md](docs/manual-qa.md).

## Deploying

Push to Vercel and set the three environment variables in project settings.
`getUserMedia` requires HTTPS, which Vercel provides. Testing across two machines
needs the deployed URL — `localhost` is a secure context only on the machine
serving it.
