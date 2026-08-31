import { describe, it, expect, afterEach } from "vitest";
import { serverEnv, MissingEnvError } from "./env";

const saved = process.env.DATABASE_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("serverEnv", () => {
  it("returns the configured connection string", () => {
    process.env.DATABASE_URL = "postgres://user:pw@host/db";
    expect(serverEnv()).toEqual({ databaseUrl: "postgres://user:pw@host/db" });
  });

  it("throws MissingEnvError naming the absent variable", () => {
    delete process.env.DATABASE_URL;
    expect(() => serverEnv()).toThrow(MissingEnvError);
    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
  });
});
