// Safe on both server and client. Nothing here fetches anything.
//
// Every embed URL is built from a platform + an ID that passed a strict regex,
// never from the raw link someone pasted, so a pasted link can't inject a src.

export type Platform = "youtube" | "tiktok" | "instagram";
export type ParsedReel = { platform: Platform; extId: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const TT_ID = /^\d{8,25}$/;

function toUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m)\./, "");
}

function pick(
  platform: Platform,
  id: string | null | undefined,
  re: RegExp,
): ParsedReel | null {
  return id && re.test(id) ? { platform, extId: id } : null;
}

export function parseReelUrl(raw: string): ParsedReel | null {
  const u = toUrl(raw);
  if (!u) return null;
  const host = hostOf(u);
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return pick("youtube", parts[0], YT_ID);

  if (host === "youtube.com") {
    if (parts[0] === "shorts" || parts[0] === "embed") {
      return pick("youtube", parts[1], YT_ID);
    }
    if (parts[0] === "watch") {
      return pick("youtube", u.searchParams.get("v"), YT_ID);
    }
    return null;
  }

  if (host === "tiktok.com") {
    const v = parts.indexOf("video");
    if (v !== -1) return pick("tiktok", parts[v + 1], TT_ID);
    if (parts[0] === "embed" && parts[1] === "v2") {
      return pick("tiktok", parts[2], TT_ID);
    }
    if (parts[0] === "v") {
      return pick("tiktok", parts[1]?.replace(/\.html$/, ""), TT_ID);
    }
    return null;
  }

  if (host === "instagram.com") {
    const i = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    if (i === -1 || parts[i + 1] === "audio") return null;
    return pick("instagram", parts[i + 1], IG_CODE);
  }

  return null;
}

/** vm.tiktok.com / vt.tiktok.com / tiktok.com/t/xxx need a redirect lookup first. */
export function isTikTokShortLink(raw: string): boolean {
  const u = toUrl(raw);
  if (!u) return false;
  const host = hostOf(u);
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return true;
  const parts = u.pathname.split("/").filter(Boolean);
  return host === "tiktok.com" && parts[0] === "t" && Boolean(parts[1]);
}

export function embedSrc(
  platform: Platform,
  extId: string,
  autoplay = true,
): string {
  switch (platform) {
    case "youtube":
      return (
        `https://www.youtube-nocookie.com/embed/${extId}` +
        `?playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${extId}` +
        `&autoplay=${autoplay ? 1 : 0}&mute=1`
      );
    case "tiktok":
      return `https://www.tiktok.com/embed/v2/${extId}`;
    case "instagram":
      return `https://www.instagram.com/reel/${extId}/embed/`;
  }
}

/** The original post, for the optional "open in app" link. */
export function originalUrl(platform: Platform, extId: string): string {
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/shorts/${extId}`;
    case "tiktok":
      return `https://www.tiktok.com/@/video/${extId}`;
    case "instagram":
      return `https://www.instagram.com/reel/${extId}/`;
  }
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram",
};
