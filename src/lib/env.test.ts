import { describe, it, expect, afterEach } from "vitest";
import { publicEnv, MissingEnvError } from "./env";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(url?: string, key?: string) {
  for (const k of KEYS) saved[k] = process.env[k];
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
}

describe("publicEnv", () => {
  it("returns the configured values", () => {
    setEnv("https://x.supabase.co", "anon-key");
    expect(publicEnv()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon-key",
    });
  });

  it("throws MissingEnvError naming the absent variable", () => {
    setEnv(undefined, "anon-key");
    expect(() => publicEnv()).toThrow(MissingEnvError);
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
