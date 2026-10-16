import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { isTikTokShortLink, parseReelUrl, type Platform } from "@/lib/reels";
import { clean, fetchOEmbed, resolveTikTokShortLink } from "@/lib/reels-server";
import { maybeRefreshYouTube, youtubeEnabled } from "@/lib/youtube";

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
  "id, platform, ext_id, title, author, source, added_by, added_by_name, created_at";

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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();

  const params = new URL(req.url).searchParams;
  const beforeRaw = params.get("before");
  const before = beforeRaw === null ? null : Number(beforeRaw);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 10, 1), 30);

  const page = () =>
    before !== null && Number.isSafeInteger(before) && before > 0
      ? query<Row>(
          `select ${COLS} from reels where id < $1 order by id desc limit $2`,
          [before, limit + 1],
        )
      : query<Row>(`select ${COLS} from reels order by id desc limit $1`, [
          limit + 1,
        ]);

  let rows = await page();
  const firstPage = beforeRaw === null;

  if (firstPage && youtubeEnabled()) {
    if (rows.length === 0) {
      // Brand new feed: fill it now so the first visit isn't empty.
      await maybeRefreshYouTube();
      rows = await page();
    } else {
      after(() => maybeRefreshYouTube());
    }
  }

  const hasMore = rows.length > limit;
  return NextResponse.json(
    {
      reels: rows.slice(0, limit).map((r) => toReel(r, session.user.id)),
      hasMore,
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
     returning ${COLS}`,
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
