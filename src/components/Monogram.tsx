const SIZES = {
  hero: "text-[clamp(4rem,18vw,11rem)]",
  compact: "text-xl",
} as const;

/**
 * The wordmark. Gold letters with the join between them in neon — the two
 * people, and the thing between them.
 */
export function Monogram({
  size = "compact",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span className={`monogram ${SIZES[size]} ${className}`} aria-label="M and K">
      <span aria-hidden>M</span>
      <span className="join" aria-hidden>
        {" + "}
      </span>
      <span aria-hidden>K</span>
    </span>
  );
}
