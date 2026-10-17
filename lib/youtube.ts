import { query } from "@/lib/db";
import { clean } from "@/lib/reels-server";
import { ALL_TOPICS } from "@/lib/topics";

// YOUTUBE_API_BASE only exists so tests can point at a fake server.
const API = process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3";
const MAX_SECONDS = 90;
const PER_REFRESH = 30;
const SEARCHES_PER_REFRESH = 2;

export function youtubeEnabled(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function intEnv(name: string, fallback: number, min: number): number {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Minimum gap between refreshes for one person. */
const minMinutes = () => intEnv("REELS_MIN_REFRESH_MINUTES", 8, 1);
/** Each search costs 100 of the free 10,000 daily units, so 80 a day leaves headroom. */
const dailySearches = () => intEnv("YT_DAILY_SEARCHES", 80, 2);

/** Extra discovery topics from REEL_QUERIES, on top of the built-in pool. */
function customTopics(): string[] {
  return (process.env.REEL_QUERIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
type Found = { id: string; title: string; author: string; topic: string };

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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
 * One topic search. Sort order and age window are randomised on every call, so
 * the same topic keeps turning up different videos instead of the same top 25.
 */
async function findShorts(topic: string): Promise<Found[]> {
  const days = pick([3, 14, 60, 180, 365]);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const search = await yt<SearchResp>("search", {
    part: "id",
    type: "video",
    q: `${topic} #shorts`,
    videoDuration: "short",
    videoEmbeddable: "true",
    order: pick(["relevance", "viewCount", "rating", "date"]),
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
      topic,
    }));
}

/** Atomically reserves searches against today's budget. False means out of quota. */
async function reserveBudget(n: number): Promise<boolean> {
  const rows = await query(
    `insert into yt_budget (day, searches) values (current_date, $1::int)
     on conflict (day) do update set searches = yt_budget.searches + $1::int
       where yt_budget.searches + $1::int <= $2::int
     returning searches`,
    [n, dailySearches()],
  );
  return rows.length > 0;
}

/**
 * What to search for this person: one of their picked interests (if any) plus
 * random discovery from the whole pool. Nothing here reads anyone's YouTube
 * account or watch history; it's the in-app picks plus randomness.
 */
async function pickTopics(userId: string): Promise<string[]> {
  const mine = (
    await query<{ topic: string }>(
      `select topic from user_interests where user_id = $1`,
      [userId],
    )
  ).map((r) => r.topic);
  const chosen = mine.length ? [pick(mine)] : [];
  const pool = shuffle([...new Set([...ALL_TOPICS, ...customTopics()])]).filter(
    (t) => !chosen.includes(t),
  );
  while (chosen.length < SEARCHES_PER_REFRESH && pool.length) {
    chosen.push(pool.pop() as string);
  }
  return chosen;
}

/**
 * Tops up the feed with new Shorts, aimed at this person (their interests plus
 * discovery). Called whenever someone's unseen pile runs low, so the feed keeps
 * growing as they scroll. Guards: one refresh per person per few minutes (an
 * atomic claim), and a daily cap on searches so the free quota can't run dry.
 * Never throws: failures log a message and the next window tries again.
 */
export async function refreshForUser(userId: string): Promise<number> {
  if (!youtubeEnabled()) return 0;
  try {
    const key = `yt_u:${userId}`;
    await query(
      `insert into reel_meta (key, value) values ($1, to_timestamp(0))
       on conflict (key) do nothing`,
      [key],
    );
    const claimed = await query(
      `update reel_meta set value = now()
       where key = $1 and value < now() - make_interval(mins => $2::int)
       returning key`,
      [key, minMinutes()],
    );
    if (claimed.length === 0) return 0;

    const topics = await pickTopics(userId);
    if (topics.length === 0 || !(await reserveBudget(topics.length))) {
      return 0; // out of quota for today, tomorrow's budget picks it back up
    }

    try {
      const batches = await Promise.all(topics.map((t) => findShorts(t)));
      const seen = new Set<string>();
      const unique = batches.flat().filter((v) => !seen.has(v.id) && seen.add(v.id));

      let added = 0;
      for (const v of shuffle(unique).slice(0, PER_REFRESH)) {
        const r = await query(
          `insert into reels (platform, ext_id, title, author, source, topic)
           values ('youtube', $1, $2, $3, 'youtube', $4)
           on conflict (platform, ext_id) do nothing returning id`,
          [v.id, v.title, v.author, v.topic],
        );
        added += r.length;
      }
      return added;
    } catch (err) {
      console.error(
        "youtube refresh failed:",
        err instanceof Error ? err.message : "unknown error",
      );
      return 0;
    }
  } catch (err) {
    console.error(
      "youtube refresh bookkeeping failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return 0;
  }
}

/** Lets a person's next feed load refresh right away (used after they change interests). */
export async function resetRefreshWindow(userId: string): Promise<void> {
  await query(`delete from reel_meta where key = $1`, [`yt_u:${userId}`]);
}
