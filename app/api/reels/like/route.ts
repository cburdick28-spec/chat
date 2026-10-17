import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";

// Heart or un-heart a reel. Hearts nudge the person's feed toward that reel's topic.
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let data: { id?: unknown; liked?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof data.liked !== "boolean") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  await ensureSchema();
  const me = session.user.id;

  if (data.liked) {
    const rows = await query(
      `insert into reel_likes (user_id, reel_id)
       select $1::text, r.id from reels r where r.id = $2
       on conflict do nothing returning reel_id`,
      [me, id],
    );
    if (rows.length === 0) {
      const exists = await query(`select 1 from reels where id = $1`, [id]);
      if (exists.length === 0) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
    }
  } else {
    await query(`delete from reel_likes where user_id = $1 and reel_id = $2`, [
      me,
      id,
    ]);
  }
  const [{ likes }] = await query<{ likes: number }>(
    `select count(*)::int as likes from reel_likes where reel_id = $1`,
    [id],
  );
  return NextResponse.json({ liked: data.liked, likes });
}
