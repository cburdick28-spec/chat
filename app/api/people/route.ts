import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, query } from "@/lib/db";
import { ALL, touchPerson } from "@/lib/people";

type PersonRow = { id: string; name: string; unread: number };

// Everyone you can message, with unread counts. Polled lightly by the chat list.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureSchema();
  const me = session.user.id;
  await touchPerson(me, session.user.name ?? "someone");

  const people = await query<PersonRow>(
    `select p.id, p.name,
       (select count(*)::int from messages m
         where m.author_id = p.id and m.recipient_id = $1::text
           and m.id > coalesce((select last_read_id from dm_reads
                                where user_id = $1::text and peer_id = p.id), 0)
       ) as unread
     from people p
     where p.id <> $1::text
     order by (select max(m.id) from messages m
                where (m.author_id = p.id and m.recipient_id = $1::text)
                   or (m.author_id = $1::text and m.recipient_id = p.id)) desc nulls last,
              lower(p.name)`,
    [me],
  );

  const [{ unread: groupUnread }] = await query<{ unread: number }>(
    `select count(*)::int as unread from messages m
     where m.recipient_id is null and m.author_id <> $1::text
       and m.id > coalesce((select last_read_id from dm_reads
                            where user_id = $1::text and peer_id = $2), 0)`,
    [me, ALL],
  );

  return NextResponse.json(
    { people, groupUnread },
    { headers: { "Cache-Control": "no-store" } },
  );
}
