import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { ensureSchema, query } from "@/lib/db";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const INVITE_KEY = "invite:global";
const MAX_BAD_INVITES = 20; // per 15 minutes, across all callers

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const inviteCode = process.env.INVITE_CODE;
  if (!inviteCode) {
    return NextResponse.json(
      { error: "Sign-ups are turned off." },
      { status: 403 },
    );
  }

  let data: { username?: unknown; password?: unknown; invite?: unknown };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const username = String(data.username ?? "")
    .trim()
    .toLowerCase();
  const password = String(data.password ?? "");
  const invite = String(data.invite ?? "").trim();

  // Throttle wrong guesses across everyone, so the code can't be brute-forced.
  // The key has a colon, which real usernames can't contain, so it never collides.
  await ensureSchema();
  const [{ fails }] = await query<{ fails: number }>(
    `select count(*)::int as fails from login_failures
     where username = $1 and at > now() - interval '15 minutes'`,
    [INVITE_KEY],
  );
  if (fails >= MAX_BAD_INVITES) {
    return NextResponse.json(
      { error: "Too many wrong codes. Try again in a bit." },
      { status: 429 },
    );
  }
  if (!codesMatch(invite, inviteCode)) {
    await query(`insert into login_failures (username) values ($1)`, [
      INVITE_KEY,
    ]);
    return NextResponse.json({ error: "Wrong invite code." }, { status: 403 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username: 3-20 characters, letters, numbers, underscores." },
      { status: 400 },
    );
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json(
      { error: "Password needs to be 8-72 characters." },
      { status: 400 },
    );
  }

  await ensureSchema();
  const hash = await bcrypt.hash(password, 10);
  const inserted = await query(
    `insert into users (username, password_hash) values ($1, $2)
     on conflict (username) do nothing returning id`,
    [username, hash],
  );
  if (inserted.length === 0) {
    return NextResponse.json(
      { error: "That username is taken." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
