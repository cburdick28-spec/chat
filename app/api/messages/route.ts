import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { touchPerson } from "@/lib/people";

const MAX_BODY = 2000;

type Row = {
  id: string;
  author_id: string;
  author: string;
  recipient_id: string | null;
  body: string;
  created_at: string;
  reel_platform: string | null;
  reel_ext_id: string | null;
  reel_title: string | null;
  reel_author: string | null;
};

const COLS =
  "id, author_id, author, recipient_id, body, created_at, reel_platform, reel_ext_id, reel_title, reel_author";

function toMessage(r: Row) {
  return {
    id: Number(r.id),
    authorId: r.author_id,
    author: r.author,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
    reel:
      r.reel_platform && r.reel_ext_id
        ? {
            platform: r.reel_platform,
            extId: r.reel_ext_id,
            title: r.reel_title ?? "",
            author: r.reel_author ?? "",
          }
        : null,
  };
}

// A conversation is either the everyone chat (recipient_id is null) or a private
// thread between two people. The everyone query MUST keep `recipient_id is null`,
// or private messages would leak into it.
function threadFilter(peer: string | null) {
  return peer === null
    ? { sql: `recipient_id is null`, params: [] as unknown[] }
    : {
        sql: `((author_id = $1 and recipient_id = $2) or (author_id = $2 and recipient_id = $1))`,
        params: [peer] as unknown[],
      };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();
  const me = session.user.id;

  const search = new URL(req.url).searchParams;
  const afterParam = search.get("after");
  const after = afterParam === null ? null : Number(afterParam);
  const withParam = search.get("with");
  const peer = withParam && withParam !== "all" ? withParam : null;
  if (peer !== null && peer.length > 200) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // $1 is always me for private threads; the everyone chat takes no user params.
  const filter = threadFilter(peer);
  const base = peer === null ? [] : [me, ...filter.params];
  const n = base.length;

  const rows =
    after !== null && Number.isSafeInteger(after) && after >= 0
      ? await query<Row>(
          `select ${COLS} from messages
           where ${filter.sql} and id > $${n + 1} order by id asc limit 100`,
          [...base, after],
        )
      : await query<Row>(
          `select * from (
             select ${COLS} from messages
             where ${filter.sql} order by id desc limit 50
           ) recent order by id asc`,
          base,
        );

  return NextResponse.json(
    { messages: rows.map(toMessage) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let data: { body?: unknown; to?: unknown; reelId?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Postgres text columns reject NUL bytes, so strip them instead of 500ing.
  const body =
    typeof data.body === "string" ? data.body.replace(/\u0000/g, "").trim() : "";
  const reelId =
    data.reelId === undefined || data.reelId === null ? null : Number(data.reelId);
  if (reelId !== null && (!Number.isSafeInteger(reelId) || reelId <= 0)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (body.length > MAX_BODY || (!body && reelId === null)) {
    return NextResponse.json(
      { error: `Message must be 1-${MAX_BODY} characters.` },
      { status: 400 },
    );
  }

  const to =
    data.to === undefined || data.to === null || data.to === "all"
      ? null
      : typeof data.to === "string" && data.to.length <= 200
        ? data.to
        : undefined;
  if (to === undefined) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  await ensureSchema();
  const userId = session.user.id;
  const name = session.user.name ?? "someone";
  await touchPerson(userId, name);

  if (to !== null) {
    if (to === userId) {
      return NextResponse.json(
        { error: "You can't message yourself." },
        { status: 400 },
      );
    }
    const exists = await query(`select 1 from people where id = $1`, [to]);
    if (exists.length === 0) {
      return NextResponse.json({ error: "Who's that?" }, { status: 404 });
    }
  }

  // The reel snapshot comes from our own table, never from the request.
  let reel: { platform: string; ext_id: string; title: string; author: string } | null =
    null;
  if (reelId !== null) {
    const [r] = await query<{
      platform: string;
      ext_id: string;
      title: string;
      author: string;
    }>(`select platform, ext_id, title, author from reels where id = $1`, [reelId]);
    if (!r) {
      return NextResponse.json({ error: "That reel is gone." }, { status: 404 });
    }
    reel = r;
  }

  const [{ recent }] = await query<{ recent: number }>(
    `select count(*)::int as recent from messages
     where author_id = $1 and created_at > now() - interval '10 seconds'`,
    [userId],
  );
  if (recent >= 8) {
    return NextResponse.json({ error: "Slow down a sec." }, { status: 429 });
  }

  const [row] = await query<Row>(
    `insert into messages
       (author_id, author, recipient_id, body,
        reel_platform, reel_ext_id, reel_title, reel_author)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${COLS}`,
    [
      userId,
      name,
      to,
      body,
      reel?.platform ?? null,
      reel?.ext_id ?? null,
      reel?.title ?? null,
      reel?.author ?? null,
    ],
  );
  return NextResponse.json({ message: toMessage(row) }, { status: 201 });
}
