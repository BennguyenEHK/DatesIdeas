import { dayItems } from "./film";
import { occurrenceInYear } from "./occasions";
import type { AlbumItem, Occasion, TimeZone } from "./types";

export interface DayFilmFacts {
  items: AlbumItem[];
  title: string;
  subtitle: string | null;
  closing: string | null;
}

/** The words around a day's film, derived without reference to the viewer's clock. */
export function dayFilmFacts(
  items: AlbumItem[],
  occasions: Occasion[],
  day: string,
  timeZone: TimeZone,
): DayFilmFacts {
  const dayYear = Number(day.slice(0, 4));
  const occasion = occasions.find(
    (candidate) =>
      (!candidate.yearly && candidate.onDate === day) ||
      (candidate.yearly && occurrenceInYear(candidate.onDate, dayYear) === day),
  );
  const dayMemories = dayItems(items, day, timeZone);

  return {
    items: dayMemories,
    title: new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day}T12:00:00Z`)),
    subtitle: occasion?.title ?? null,
    closing: dayMemories.find((item) => item.caption?.trim())?.caption ?? null,
  };
}
