import { describe, expect, test } from "bun:test";
import { youtubeVideoIdRoute } from "../src/routes/youtube";
import { parseYoutubeVideoId } from "../src/youtube";

describe("YouTube video links", () => {
  test("accepts watch, short, embed, live and youtu.be URLs", () => {
    const videoId = "dQw4w9WgXcQ";
    expect(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${videoId}&t=20`)).toBe(videoId);
    expect(parseYoutubeVideoId(`https://youtube.com/shorts/${videoId}`)).toBe(videoId);
    expect(parseYoutubeVideoId(`https://www.youtube.com/embed/${videoId}`)).toBe(videoId);
    expect(parseYoutubeVideoId(`https://www.youtube.com/live/${videoId}`)).toBe(videoId);
    expect(parseYoutubeVideoId(`https://youtu.be/${videoId}`)).toBe(videoId);
  });

  test("rejects non-YouTube hosts, insecure URLs and malformed video IDs", () => {
    expect(parseYoutubeVideoId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYoutubeVideoId("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYoutubeVideoId("https://youtube.com/watch?v=not-a-vid")).toBeNull();
    expect(parseYoutubeVideoId("javascript:alert(1)")).toBeNull();
  });

});

describe("youtubeVideoIdRoute", () => {
  test("returns an ID for a valid link", async () => {
    const response = await youtubeVideoIdRoute(
      new Request("http://localhost/youtube/video-id", {
        method: "POST",
        body: new URLSearchParams({ url: "https://youtu.be/dQw4w9WgXcQ" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  test("rejects invalid URLs with a readable error", async () => {
    const response = await youtubeVideoIdRoute(
      new Request("http://localhost/youtube/video-id", {
        method: "POST",
        body: new URLSearchParams({ url: "https://example.com/watch?v=dQw4w9WgXcQ" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });
});
