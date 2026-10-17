import {
  extractReelLinks,
  isTikTokShortLink,
  originalUrl,
  parseReelUrl,
  type ParsedReel,
  type Platform,
} from "@/lib/reels";

/** Strip control chars (Postgres rejects NUL), trim, and cap length. */
export function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const UA =
  "Mozilla/5.0 (compatible; friends-chat/1.0; +https://github.com/cburdick28-spec/chat)";

/**
 * Follows a TikTok short link (vm.tiktok.com/xyz) by hand so we only ever
 * talk to tiktok.com hosts, and returns the full video URL.
 */
export async function resolveTikTokShortLink(raw: string): Promise<string | null> {
  let url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !/(^|\.)tiktok\.com$/i.test(u.hostname)) {
      return null;
    }
    if (parseReelUrl(u.toString())) return u.toString();
    try {
      const res = await fetch(u, {
        redirect: "manual",
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(4000),
      });
      const loc = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !loc) return null;
      url = new URL(loc, u).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Best-effort title/author from the platforms' public oEmbed endpoints.
 * Instagram needs a Meta app token, so it just gets blank metadata.
 * The lookup URL is rebuilt from the validated ID, never from user input.
 */
export async function fetchOEmbed(
  platform: Platform,
  extId: string,
): Promise<{ title: string; author: string }> {
  const blank = { title: "", author: "" };
  let endpoint: string;
  if (platform === "youtube") {
    endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(originalUrl(platform, extId))}`;
  } else if (platform === "tiktok") {
    endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(originalUrl(platform, extId))}`;
  } else {
    return blank;
  }
  try {
    const res = await fetch(endpoint, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return blank;
    const data = (await res.json()) as { title?: unknown; author_name?: unknown };
    return { title: clean(data.title, 200), author: clean(data.author_name, 80) };
  } catch {
    return blank;
  }
}

/**
 * The first reel link in a piece of text, resolved to a platform + validated ID.
 * TikTok short links get one redirect lookup. Returns the matching token too, so
 * a message that is only the link can drop it and show just the card.
 */
export async function findReelInText(
  text: string,
): Promise<(ParsedReel & { token: string }) | null> {
  for (const token of extractReelLinks(text).slice(0, 3)) {
    let parsed = parseReelUrl(token);
    if (!parsed && isTikTokShortLink(token)) {
      const full = await resolveTikTokShortLink(token);
      if (full) parsed = parseReelUrl(full);
    }
    if (parsed) return { ...parsed, token };
  }
  return null;
}
