import { neon } from "@neondatabase/serverless";

type Row = Record<string, unknown>;
type Driver = (text: string, params?: unknown[]) => Promise<Row[]>;

const globalForDb = globalThis as unknown as {
  __chatDriver?: Promise<Driver>;
  __chatSchema?: Promise<void>;
};

async function createDriver(): Promise<Driver> {
  // Vercel's Neon integration sometimes names it POSTGRES_URL instead.
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  if (url) {
    const sql = neon(url);
    return async (text, params = []) => (await sql.query(text, params)) as Row[];
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set");
  }

  // Local dev only: an in-process Postgres so `npm run dev` works with zero setup.
  const { mkdirSync } = await import("node:fs");
  mkdirSync("./.data", { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite("./.data/dev-db");
  return async (text, params = []) => {
    const res = await db.query<Row>(text, params);
    return res.rows;
  };
}

function driver(): Promise<Driver> {
  globalForDb.__chatDriver ??= createDriver();
  return globalForDb.__chatDriver;
}

export async function query<T = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const run = await driver();
  return (await run(text, params)) as T[];
}

async function createSchema() {
  await query(`
    create table if not exists users (
      id bigserial primary key,
      username text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists messages (
      id bigserial primary key,
      author_id text not null,
      author text not null,
      body text not null,
      created_at timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists login_failures (
      username text not null,
      at timestamptz not null default now()
    )
  `);
  await query(
    `create index if not exists login_failures_username_at on login_failures (username, at)`,
  );
  await query(
    `create index if not exists messages_author_created on messages (author_id, created_at)`,
  );
  await query(`
    create table if not exists reels (
      id bigserial primary key,
      platform text not null,
      ext_id text not null,
      title text not null default '',
      author text not null default '',
      source text not null default 'user',
      added_by text,
      added_by_name text,
      created_at timestamptz not null default now(),
      unique (platform, ext_id)
    )
  `);
  await query(`
    create table if not exists reel_meta (
      key text primary key,
      value timestamptz not null
    )
  `);
  // Which topic search found a reel, so a person's interests can bump matching ones.
  await query(`alter table reels add column if not exists topic text`);
  // What each person has already scrolled past. Drives the per-user feed.
  await query(`
    create table if not exists reel_seen (
      user_id text not null,
      reel_id bigint not null references reels(id) on delete cascade,
      seen_at timestamptz not null default now(),
      primary key (user_id, reel_id)
    )
  `);
  await query(
    `create index if not exists reel_seen_user_at on reel_seen (user_id, seen_at)`,
  );
  await query(`
    create table if not exists user_interests (
      user_id text not null,
      topic text not null,
      primary key (user_id, topic)
    )
  `);
  // YouTube search quota is finite (100 units a search), so count searches per day.
  await query(`
    create table if not exists yt_budget (
      day date primary key,
      searches int not null default 0
    )
  `);
}

/** Creates tables on first use. Safe to call on every request. */
export function ensureSchema(): Promise<void> {
  if (!globalForDb.__chatSchema) {
    globalForDb.__chatSchema = createSchema().catch((err) => {
      globalForDb.__chatSchema = undefined; // retry next request
      throw err;
    });
  }
  return globalForDb.__chatSchema;
}
