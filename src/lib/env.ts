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
