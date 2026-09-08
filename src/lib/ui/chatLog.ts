/** One line in the small, bounded conversation beside the film. */
export interface ChatLine {
  id: string;
  text: string;
  at: number;
  mine: boolean;
}

/** Enough context for an evening, without retaining the whole evening forever. */
export const CHAT_KEEP = 50;

/**
 * Adds a line only once and returns the conversation in the order it was
 * written. A data channel may repeat or delay a frame, neither of which should
 * change what the two people read.
 */
export function addLine(log: readonly ChatLine[], line: ChatLine): ChatLine[] {
  if (log.some((existing) => existing.id === line.id)) return [...log];

  return [...log, line]
    .sort((left, right) => left.at - right.at)
    .slice(-CHAT_KEEP);
}

/** Formats a timestamp as the unobtrusive local clock shown beside each line. */
export function formatClock(at: number): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(at));

  return parts
    .filter(({ type }) => type === "hour" || type === "minute" || type === "dayPeriod")
    .map(({ value, type }) => (type === "dayPeriod" ? value.toLowerCase() : value))
    .join("")
    .replace(/(\d)(\d{2})([a-z]+)/, "$1:$2$3");
}
