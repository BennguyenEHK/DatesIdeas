const IDENTITY_KEY = "datesidea.identity";
const NAME_KEY = "datesidea.name";
const ROOM_KEY = "datesidea.room";

/**
 * A device-local UUID. This is not an account — it exists only so history
 * rows can tell the two participants apart.
 */
export function getIdentity(): string {
  const existing = localStorage.getItem(IDENTITY_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(IDENTITY_KEY, id);
  return id;
}

export function getDisplayName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function setDisplayName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function getSavedRoom(): string | null {
  return localStorage.getItem(ROOM_KEY);
}

export function saveRoom(code: string): void {
  localStorage.setItem(ROOM_KEY, code.toUpperCase());
}
