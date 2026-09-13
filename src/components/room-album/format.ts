/** Presentation-only date formatting for the small in-call album frame. */
export function formatAlbumDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
