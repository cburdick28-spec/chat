import { query } from "@/lib/db";
import { clean } from "@/lib/reels-server";

// YOUTUBE_API_BASE only exists so tests can point at a fake server.
const API = process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3";
const MAX_SECONDS = 90;
const PER_REFRESH = 24;

const DEFAULT_QUERIES = [
  "basketball highlights",
  "football skills",
  "funny moments",
  "satisfying",
  "gaming clips",
  "cool tech",
];

export function youtubeEnabled(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function refreshHours(): number {
  const n = Math.floor(Number(process.env.REELS_REFRESH_HOURS));
  return Number.isFinite(n) && n >= 1 ? n : 6;
}

function topics(): string[] {
  const custom = (process.env.REEL_QUERIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return custom.length ? custom : DEFAULT_QUERIES;
}

function durationSeconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return Infinity;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  // Message deliberately leaves the URL out so the API key never reaches logs.
  if (!res.ok) throw new Error(`YouTube API ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

type SearchResp = { items?: { id?: { videoId?: string } }[] };
type VideosResp = {
  items?: {
    id: string;
    snippet?: { title?: string; channelTitle?: string };
    contentDetails?: { duration?: string };
    status?: { embeddable?: boolean; privacyStatus?: string };
  }[];
};
type Found = { id: string; title: string; author: string };

async function findShorts(topic: string): Promise<Found[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const search = await yt<SearchResp>("search", {
    part: "id",
    type: "video",
    q: `${topic} #shorts`,
    videoDuration: "short",
    videoEmbeddable: "true",
    order: "viewCount",
    publishedAfter: since,
    safeSearch: "strict",
    maxResults: "25",
  });
  const ids = (search.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((x): x is string => Boolean(x) && /^[A-Za-z0-9_-]{11}$/.test(x ?? ""));
  if (ids.length === 0) return [];

  const vids = await yt<VideosResp>("videos", {
    part: "snippet,contentDetails,status",
    id: ids.join(","),
    maxResults: "25",
  });
  return (vids.items ?? [])
    .filter(
      (v) =>
        v.status?.embeddable === true &&
        v.status?.privacyStatus === "public" &&
        durationSeconds(v.contentDetails?.duration ?? "") <= MAX_SECONDS,
    )
    .map((v) => ({
      id: v.id,
      title: clean(v.snippet?.title, 200),
      author: clean(v.snippet?.channelTitle, 80),
    }));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pulls fresh Shorts into the feed if the last refresh is older than the
 * window (default 6h). The UPDATE ... RETURNING is an atomic claim, so when
 * several people open the feed at once only one request does the work.
 * Never throws: a failed refresh just logs and retries in ~30 minutes.
 */
export async function maybeRefreshYouTube(): Promise<number> {
  if (!youtubeEnabled()) return 0;
  const hours = refreshHours();
  try {
    await query(
      `insert into reel_meta (key, value) values ('yt_refresh', to_timestamp(0))
       on conflict (key) do nothing`,
    );
    const claimed = await query(
      `update reel_meta set value = now()
       where key = 'yt_refresh' and value < now() - make_interval(hours => $1::int)
       returning key`,
      [hours],
    );
    if (claimed.length === 0) return 0;

    try {
      const all = topics();
      const slot = Math.floor(Date.now() / (hours * 3_600_000));
      const chosen = [...new Set([all[slot % all.length], all[(slot + 1) % all.length]])];
      const batches = await Promise.all(chosen.map((t) => findShorts(t)));
      const seen = new Set<string>();
      const unique = batches.flat().filter((v) => !seen.has(v.id) && seen.add(v.id));

      let added = 0;
      for (const v of shuffle(unique).slice(0, PER_REFRESH)) {
        const r = await query(
          `insert into reels (platform, ext_id, title, author, source)
           values ('youtube', $1, $2, $3, 'youtube')
           on conflict (platform, ext_id) do nothing returning id`,
          [v.id, v.title, v.author],
        );
        added += r.length;
      }
      return added;
    } catch (err) {
      console.error("youtube refresh failed:", err instanceof Error ? err.message : "unknown error");
      await query(
        `update reel_meta
         set value = now() - make_interval(hours => $1::int) + interval '30 minutes'
         where key = 'yt_refresh'`,
        [hours],
      );
      return 0;
    }
  } catch (err) {
    console.error("youtube refresh bookkeeping failed:", err instanceof Error ? err.message : "unknown error");
    return 0;
  }
}
