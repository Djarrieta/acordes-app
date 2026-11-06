const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export function parseYoutubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const videoId =
    url.hostname.toLowerCase() === "youtu.be"
      ? segments[0]
      : segments[0] === "watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live"].includes(segments[0] ?? "")
          ? segments[1]
          : null;
  return videoId && YOUTUBE_VIDEO_ID.test(videoId) ? videoId : null;
}
