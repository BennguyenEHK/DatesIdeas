/**
 * The atmosphere behind every page: twilight ground, a warm glow low on the
 * horizon (the streetlamp, not a poster gradient), a faint starfield, and film
 * grain. Purely decorative — it never intercepts a pointer event.
 */

/** Deterministic so the server and client agree; Math.random would rehydrate wrong. */
function seededStars(count: number) {
  let seed = 20260831;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: next() * 100,
    // Stars thin out toward the horizon, where the glow washes them out.
    top: next() * 72,
    size: 0.6 + next() * 1.4,
    opacity: 0.18 + next() * 0.5,
    delay: next() * 8,
  }));
}

const STARS = seededStars(90);

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E\")";

export function Ambience() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[var(--night)]" />

      {/* Violet lift toward the top of the sky. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, var(--dusk) 0%, var(--night) 46%, var(--night) 100%)",
        }}
      />

      {STARS.map((s) => (
        <span
          key={s.id}
          className="twinkle absolute rounded-full bg-[var(--cream)]"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: s.opacity,
            animation: `twinkle 6s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* The horizon glow — warm, low, and wide. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[55vh]"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 100%, rgba(232,185,74,0.20) 0%, rgba(199,75,109,0.10) 38%, transparent 72%)",
        }}
      />

      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{ backgroundImage: GRAIN, opacity: 0.28 }}
      />

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: var(--o, 0.3); }
          50% { opacity: 0.05; }
        }
      `}</style>
    </div>
  );
}
