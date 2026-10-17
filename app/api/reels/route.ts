import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { isTikTokShortLink, parseReelUrl, type Platform } from "@/lib/reels";
import { clean, fetchOEmbed, resolveTikTokShortLink } from "@/lib/reels-server";
import { refreshForUser, youtubeEnabled } from "@/lib/youtube";

type Row = {
  id: string;
  platform: Platform;
  ext_id: string;
  title: string;
  author: string;
  source: string;
  added_by: string | null;
  added_by_name: string | null;
  created_at: string;
};

const COLS =
  "r.id, r.platform, r.ext_id, r.title, r.author, r.source, r.added_by, r.added_by_name, r.created_at";

function toReel(r: Row, me: string) {
  return {
    id: Number(r.id),
    platform: r.platform,
    extId: r.ext_id,
    title: r.title,
    author: r.author,
    auto: r.source !== "user",
    addedBy: r.added_by_name,
    mine: r.added_by !== null && r.added_by === me,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// Each person gets their own stable shuffle: a hash of (user, reel). Reels that
// match their picked interests, and links friends added in the last day, sort earlier.
const RANK = `(
  (('x' || substr(md5($1::text || ':' || r.id::text), 1, 8))::bit(32)::bigint) / 4294967296.0
  - case when r.topic is not null
      and r.topic in (select topic from user_interests where user_id = $1::text)
    then 0.35 else 0 end
  - case when r.source = 'user' and r.created_at > now() - interval '1 day'
    then 2 else 0 end
)`;

type FeedRow = Row & { ord: string };

// Reels this person hasn't seen yet, in their personal order. Keyset-paged on (rank, id).
function freshPage(userId: string, afterRank: string, afterId: string, n: number) {
  return query<FeedRow>(
    `select ${COLS}, r.rank::text as ord
     from (
       select r.*, ${RANK} as rank from reels r
       where not exists (
         select 1 from reel_seen s where s.user_id = $1::text and s.reel_id = r.id
       )
     ) r
     where (r.rank, r.id) > ($2::numeric, $3::bigint)
     order by r.rank, r.id limit $4`,
    [userId, afterRank, afterId, n],
  );
}

// Once they've seen everything, loop back through the oldest-seen first.
function replayPage(userId: string, afterEpoch: string, afterId: string, n: number) {
  return query<FeedRow>(
    `select ${COLS}, extract(epoch from s.seen_at)::numeric::text as ord
     from reels r join reel_seen s on s.reel_id = r.id and s.user_id = $1::text
     where (extract(epoch from s.seen_at)::numeric, r.id) > ($2::numeric, $3::bigint)
     order by extract(epoch from s.seen_at)::numeric, r.id limit $4`,
    [userId, afterEpoch, afterId, n],
  );
}

const CURSOR = /^([fr]):(-?\d{1,20}(?:\.\d{1,20})?):(\d{1,18})$/;
const LOW_WATER = 25; // refill when a person has fewer unseen reels than this

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();
  const me = session.user.id;

  const params = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 10, 1), 30);
  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw ? CURSOR.exec(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const firstPage = !cursor;

  const load = async () => {
    let rows: { row: Row; cur: string }[] = [];
    if (!cursor || cursor[1] === "f") {
      const fresh = await freshPage(
        me,
        cursor ? cursor[2] : "-1000",
        cursor ? cursor[3] : "0",
        limit,
      );
      rows = fresh.map((row) => ({ row, cur: `f:${row.ord}:${row.id}` }));
    }
    if (rows.length < limit) {
      const replay = await replayPage(
        me,
        cursor && cursor[1] === "r" ? cursor[2] : "0",
        cursor && cursor[1] === "r" ? cursor[3] : "0",
        limit - rows.length,
      );
      rows.push(...replay.map((row) => ({ row, cur: `r:${row.ord}:${row.id}` })));
    }
    return rows;
  };

  let rows = await load();

  if (youtubeEnabled() && firstPage) {
    const [{ unseen }] = await query<{ unseen: number }>(
      `select count(*)::int as unseen from (
         select 1 from reels r
         where not exists (
           select 1 from reel_seen s where s.user_id = $1::text and s.reel_id = r.id
         ) limit ${LOW_WATER}
       ) x`,
      [me],
    );
    if (rows.length === 0) {
      // Nothing for them at all (new feed or they've seen it all): fill now.
      await refreshForUser(me);
      rows = await load();
    } else if (unseen < LOW_WATER) {
      after(() => refreshForUser(me));
    }
  }

  const last = rows[rows.length - 1];
  return NextResponse.json(
    {
      reels: rows.map((r) => toReel(r.row, me)),
      // Null once everything (including the replay loop) is exhausted.
      nextCursor: rows.length >= limit && last ? last.cur : null,
      autoFeed: youtubeEnabled(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let data: { url?: unknown; caption?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const rawUrl = typeof data.url === "string" ? data.url : "";
  const caption = clean(data.caption, 140);

  await ensureSchema();
  const userId = session.user.id;

  const [{ recent }] = await query<{ recent: number }>(
    `select count(*)::int as recent from reels
     where added_by = $1 and created_at > now() - interval '10 minutes'`,
    [userId],
  );
  if (recent >= 10) {
    return NextResponse.json(
      { error: "That's a lot of reels. Give it a few minutes." },
      { status: 429 },
    );
  }

  let parsed = parseReelUrl(rawUrl);
  if (!parsed && isTikTokShortLink(rawUrl)) {
    const full = await resolveTikTokShortLink(rawUrl);
    if (full) parsed = parseReelUrl(full);
  }
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a YouTube Shorts, TikTok or Instagram reel link.",
      },
      { status: 400 },
    );
  }

  const meta = await fetchOEmbed(parsed.platform, parsed.extId);
  const [row] = await query<Row>(
    `insert into reels (platform, ext_id, title, author, source, added_by, added_by_name)
     values ($1, $2, $3, $4, 'user', $5, $6)
     on conflict (platform, ext_id) do nothing
     returning ${COLS.replaceAll("r.", "")}`,
    [
      parsed.platform,
      parsed.extId,
      caption || meta.title,
      meta.author,
      userId,
      session.user.name ?? "someone",
    ],
  );
  if (!row) {
    return NextResponse.json(
      { error: "That one's already in the feed." },
      { status: 409 },
    );
  }
  // They already know about their own reel, so it shouldn't come back around for them.
  await query(
    `insert into reel_seen (user_id, reel_id) values ($1, $2) on conflict do nothing`,
    [userId, row.id],
  );
  return NextResponse.json({ reel: toReel(row, userId) }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  await ensureSchema();
  // Only the person who added a reel can remove it.
  const gone = await query(
    `delete from reels where id = $1 and added_by = $2 returning id`,
    [id, session.user.id],
  );
  if (gone.length === 0) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
