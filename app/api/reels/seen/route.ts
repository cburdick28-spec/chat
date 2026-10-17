import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";

// The feed calls this once a reel has been on screen a moment, so it won't be served again.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let data: { ids?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const ids = Array.isArray(data.ids) ? data.ids : [];
  if (
    ids.length === 0 ||
    ids.length > 20 ||
    !ids.every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  await ensureSchema();
  await query(
    `insert into reel_seen (user_id, reel_id)
     select $1::text, r.id from reels r
     where r.id in (select value::bigint from json_array_elements_text($2::json))
     on conflict (user_id, reel_id) do update set seen_at = now()`,
    [session.user.id, JSON.stringify(ids)],
  );
  return NextResponse.json({ ok: true });
}
