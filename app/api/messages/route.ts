import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";

const MAX_BODY = 2000;

type Row = {
  id: string;
  author_id: string;
  author: string;
  body: string;
  created_at: string;
};

function toMessage(r: Row) {
  return {
    id: Number(r.id),
    authorId: r.author_id,
    author: r.author,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();

  const afterParam = new URL(req.url).searchParams.get("after");
  const after = afterParam === null ? null : Number(afterParam);

  const rows =
    after !== null && Number.isSafeInteger(after) && after >= 0
      ? await query<Row>(
          `select id, author_id, author, body, created_at from messages
           where id > $1 order by id asc limit 100`,
          [after],
        )
      : await query<Row>(
          `select * from (
             select id, author_id, author, body, created_at from messages
             order by id desc limit 50
           ) recent order by id asc`,
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

  let data: { body?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Postgres text columns reject NUL bytes, so strip them instead of 500ing.
  const body =
    typeof data.body === "string" ? data.body.replace(/\u0000/g, "").trim() : "";
  if (!body || body.length > MAX_BODY) {
    return NextResponse.json(
      { error: `Message must be 1-${MAX_BODY} characters.` },
      { status: 400 },
    );
  }

  await ensureSchema();
  const userId = session.user.id;

  const [{ recent }] = await query<{ recent: number }>(
    `select count(*)::int as recent from messages
     where author_id = $1 and created_at > now() - interval '10 seconds'`,
    [userId],
  );
  if (recent >= 8) {
    return NextResponse.json(
      { error: "Slow down a sec." },
      { status: 429 },
    );
  }

  const [row] = await query<Row>(
    `insert into messages (author_id, author, body) values ($1, $2, $3)
     returning id, author_id, author, body, created_at`,
    [userId, session.user.name ?? "someone", body],
  );
  return NextResponse.json({ message: toMessage(row) }, { status: 201 });
}
