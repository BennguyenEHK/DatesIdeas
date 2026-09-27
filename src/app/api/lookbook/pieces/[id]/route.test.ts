import { beforeEach, describe, expect, it, vi } from "vitest";
const queries: string[] = [];
let results: unknown[][] = [];
const deleted = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (s: TemplateStringsArray) => {
    queries.push(s.join("?"));
    return Promise.resolve(results.shift() ?? []);
  },
}));
vi.mock("@/lib/storage/objects", () => ({ deleteKeys: deleted, presignKeepsake: vi.fn() }));
const { DELETE } = await import("./route");
const pair = { id: "11111111-2222-3333-8444-555555555555", created_at: new Date() },
  params = { params: Promise.resolve({ id: "abcdef" }) },
  request = new Request("http://x", {
    method: "DELETE",
    headers: { authorization: "Bearer abcdefghijklmnopqrstuv" },
  });
beforeEach(() => {
  queries.length = 0;
  results = [];
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "secret");
  deleted.mockReset().mockResolvedValue(1);
});
describe("DELETE /api/lookbook/pieces/[id]", () => {
  it("does not delete a piece belonging to another pair", async () => {
    results = [[pair], []];
    expect((await DELETE(request, params)).status).toBe(404);
    expect(deleted).not.toHaveBeenCalled();
  });
  it("strips the deleted piece from every outfit before removing its object", async () => {
    results = [
      [pair],
      [
        {
          id: "abcdef",
          pair_id: pair.id,
          object_key: `lookbook/${pair.id}/abcdef.jpg`,
          content_type: "image/jpeg",
          bytes: 1,
          kind: "top",
          label: "",
          added_by: "K",
          created_at: new Date(),
        },
      ],
      [],
    ];
    expect((await DELETE(request, params)).status).toBe(200);
    expect(queries.at(-1)).toMatch(/jsonb_array_elements/i);
    expect(deleted).toHaveBeenCalledWith([`lookbook/${pair.id}/abcdef.jpg`]);
  });
});
