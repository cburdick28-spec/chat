import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { ALL } from "@/lib/people";

// Marks a conversation as read up to a message id.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  let data: { with?: unknown; upTo?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const peer =
    typeof data.with === "string" && data.with && data.with.length <= 200
      ? data.with
      : ALL;
  const upTo = Number(data.upTo);
  if (!Number.isSafeInteger(upTo) || upTo < 0) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  await ensureSchema();
  await query(
    `insert into dm_reads (user_id, peer_id, last_read_id) values ($1, $2, $3)
     on conflict (user_id, peer_id) do update
       set last_read_id = greatest(dm_reads.last_read_id, excluded.last_read_id)`,
    [session.user.id, peer, upTo],
  );
  return NextResponse.json({ ok: true });
}
