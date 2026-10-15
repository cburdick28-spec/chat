import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { ensureSchema, query } from "@/lib/db";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

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

  if (!codesMatch(invite, inviteCode)) {
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
