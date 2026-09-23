import { describe, expect, it } from "vitest";
import { parseYouTubeLink } from "./links";

const ID = "dQw4w9WgXcQ";
const LIST = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

describe("parseYouTubeLink", () => {
  it.each([
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=tracking`],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])("reads the song out of %s", (raw) => {
    expect(parseYouTubeLink(raw)).toEqual({ kind: "video", videoId: ID });
  });

  it("reads a playlist page as the whole list", () => {
    expect(
      parseYouTubeLink(`https://www.youtube.com/playlist?list=${LIST}`),
    ).toEqual({
      kind: "playlist",
      listId: LIST,
    });
    expect(
      parseYouTubeLink(
        "https://music.youtube.com/playlist?list=OLAK5uy_kXMgUSGQ3qDOGj7n",
      ),
    ).toEqual({ kind: "playlist", listId: "OLAK5uy_kXMgUSGQ3qDOGj7n" });
  });

  it("takes a song shared from inside a playlist as that one song", () => {
    expect(
      parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`),
    ).toEqual({
      kind: "video",
      videoId: ID,
    });
    expect(parseYouTubeLink(`https://youtu.be/${ID}?list=${LIST}`)).toEqual({
      kind: "video",
      videoId: ID,
    });
  });

  it("takes a watch link carrying only a list as the list", () => {
    expect(
      parseYouTubeLink(`https://www.youtube.com/watch?list=RD${ID}`),
    ).toEqual({
      kind: "playlist",
      listId: `RD${ID}`,
    });
  });

  it.each([
    ["another host", `https://vimeo.com/watch?v=${ID}`],
    ["a lookalike host", `https://youtube.com.evil.test/watch?v=${ID}`],
    ["a v= that is too short", "https://www.youtube.com/watch?v=short"],
    ["a v= that is too long", `https://www.youtube.com/watch?v=${ID}x`],
    ["a javascript: link", `javascript:alert("${ID}")`],
    ["a data: link", `data:text/html,https://youtu.be/${ID}`],
    [
      "a playlist id of an unknown shape",
      "https://www.youtube.com/playlist?list=XX123",
    ],
    ["a channel page", "https://www.youtube.com/@someone"],
    ["plain words", "play something nice"],
    ["nothing", "   "],
  ])("refuses %s", (_, raw) => {
    expect(parseYouTubeLink(raw)).toBeNull();
  });
});
