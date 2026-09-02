const SIZES = {
  hero: "wordmark--hero text-[clamp(2.25rem,9vw,3.75rem)]",
  compact: "wordmark--compact text-xl",
} as const;

export const APP_NAME = "FestiBooth";

/**
 * The name, built as the sign above a booth.
 *
 * role="img" with the name as its label: the glow is a second copy of the
 * word, drawn by CSS on a pseudo-element, and without this some screen
 * readers announce it twice.
 */
export function Wordmark({
  size = "compact",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={`wordmark ${SIZES[size]} ${className}`}
      data-text={APP_NAME}
      role="img"
      aria-label={APP_NAME}
    >
      {APP_NAME}
    </span>
  );
}
