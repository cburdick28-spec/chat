import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { ALL_TOPICS, MAX_INTERESTS } from "@/lib/topics";
import { resetRefreshWindow } from "@/lib/youtube";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();
  const rows = await query<{ topic: string }>(
    `select topic from user_interests where user_id = $1 order by topic`,
    [session.user.id],
  );
  return NextResponse.json({ topics: rows.map((r) => r.topic) });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let data: { topics?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!Array.isArray(data.topics)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  // Only topics from the built-in list are accepted; free text never reaches a search.
  const topics = [
    ...new Set(data.topics.filter((t): t is string => typeof t === "string")),
  ];
  if (topics.length > MAX_INTERESTS || !topics.every((t) => ALL_TOPICS.includes(t))) {
    return NextResponse.json(
      { error: `Pick up to ${MAX_INTERESTS} topics from the list.` },
      { status: 400 },
    );
  }
  await ensureSchema();
  const me = session.user.id;
  await query(`delete from user_interests where user_id = $1`, [me]);
  if (topics.length) {
    await query(
      `insert into user_interests (user_id, topic)
       select $1::text, value from json_array_elements_text($2::json)`,
      [me, JSON.stringify(topics)],
    );
  }
  await resetRefreshWindow(me);
  return NextResponse.json({ topics });
}
