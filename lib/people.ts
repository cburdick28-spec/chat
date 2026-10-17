import { query } from "@/lib/db";

/**
 * Records that this person exists, so friends can find them in the message list.
 * Called from polled routes, so it only writes when something changed or the last
 * write is over a minute old, instead of once per poll.
 */
export async function touchPerson(id: string, name: string): Promise<void> {
  await query(
    `insert into people (id, name, last_seen) values ($1, $2, now())
     on conflict (id) do update set name = excluded.name, last_seen = now()
     where people.name <> excluded.name
        or people.last_seen < now() - interval '60 seconds'`,
    [id, name.slice(0, 80)],
  );
}

/** The conversation key used for read tracking: a person's id, or 'all'. */
export const ALL = "all";
