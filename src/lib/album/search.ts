import { civilDate } from "./occasions";
import type { AlbumItem, Occasion } from "./types";

function monthName(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function searchItems(
  items: AlbumItem[],
  occasions: Occasion[],
  query: string,
  timeZone: string,
): AlbumItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return items;

  return items.filter((item) => {
    const date = civilDate(item.happenedAt, timeZone);
    const namedThatDay = occasions.some(
      (occasion) =>
        (occasion.onDate === date || (occasion.yearly && occasion.onDate.slice(5) === date.slice(5))) &&
        occasion.title.toLocaleLowerCase().includes(needle),
    );
    return (
      (item.caption?.toLocaleLowerCase().includes(needle) ?? false) ||
      date.startsWith(needle) ||
      namedThatDay ||
      monthName(date).toLocaleLowerCase().includes(needle)
    );
  });
}
