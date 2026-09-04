import { describe, it, expect, afterEach } from "vitest";
import { serverEnv, helperSecret, MissingEnvError } from "./env";

const saved = process.env.DATABASE_URL;
const savedHelperSecret = process.env.HELPER_SECRET;

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;

  if (savedHelperSecret === undefined) delete process.env.HELPER_SECRET;
  else process.env.HELPER_SECRET = savedHelperSecret;
});

describe("serverEnv", () => {
  it("returns the configured connection string", () => {
    process.env.DATABASE_URL = "postgres://user:pw@host/db";
    expect(serverEnv()).toEqual({
      databaseUrl: "postgres://user:pw@host/db",
    });
  });

  it("throws MissingEnvError naming the absent variable", () => {
    delete process.env.DATABASE_URL;
    expect(() => serverEnv()).toThrow(MissingEnvError);
    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
  });

  it("does not require the helper secret", () => {
    // The whole app reaches the database through serverEnv. If an unconfigured
    // karaoke helper could make this throw, every room in the app would go
    // down with it — which is why the secret is read separately.
    process.env.DATABASE_URL = "postgres://user:pw@host/db";
    delete process.env.HELPER_SECRET;
    expect(() => serverEnv()).not.toThrow();
  });
});

describe("helperSecret", () => {
  it("returns the configured secret", () => {
    process.env.HELPER_SECRET = "helper-secret";
    expect(helperSecret()).toBe("helper-secret");
  });

  it("throws MissingEnvError naming the absent variable", () => {
    delete process.env.HELPER_SECRET;
    expect(() => helperSecret()).toThrow(MissingEnvError);
    expect(() => helperSecret()).toThrow(/HELPER_SECRET/);
  });
});
