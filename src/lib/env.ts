export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = "MissingEnvError";
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new MissingEnvError(name);
  return value;
}

export interface ServerEnv {
  databaseUrl: string;
}

/**
 * Server-only configuration.
 *
 * There is deliberately no browser-visible counterpart. Neon's connection
 * string is a credential, not a publishable key: the client never talks to
 * Postgres at all, so nothing here may ever be prefixed with NEXT_PUBLIC_ or
 * imported from a client component.
 */
export function serverEnv(): ServerEnv {
  return {
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
  };
}

/**
 * The karaoke helper's shared secret, read on its own rather than as part of
 * ServerEnv.
 *
 * Kept separate because db() calls serverEnv(), so folding this in would make
 * every room, card and keepsake in the app fail with a missing-variable error
 * until the helper happened to be configured. An optional feature must not be
 * able to take down the room it lives in.
 *
 * Same rule as the connection string: never NEXT_PUBLIC_, never a client
 * import. This one grants the ability to drive someone's home machine.
 */
export function helperSecret(): string {
  return required("HELPER_SECRET", process.env.HELPER_SECRET);
}
