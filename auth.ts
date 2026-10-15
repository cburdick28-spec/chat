import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { ensureSchema, query } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
  }
}

export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Compared against when a username doesn't exist, so response time doesn't leak which usernames are real.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const MAX_FAILS = 8; // per username, per 15 minutes

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(googleEnabled ? [Google] : []),
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!username || !password || password.length > 72) return null;

        await ensureSchema();

        const [{ fails }] = await query<{ fails: number }>(
          `select count(*)::int as fails from login_failures
           where username = $1 and at > now() - interval '15 minutes'`,
          [username],
        );
        if (fails >= MAX_FAILS) return null;

        const [user] = await query<{
          id: string;
          username: string;
          password_hash: string;
        }>(`select id, username, password_hash from users where username = $1`, [
          username,
        ]);

        const ok = await bcrypt.compare(
          password,
          user?.password_hash ?? DUMMY_HASH,
        );

        if (!user || !ok) {
          await query(`insert into login_failures (username) values ($1)`, [
            username,
          ]);
          await query(
            `delete from login_failures where at < now() - interval '1 day'`,
          );
          return null;
        }

        await query(`delete from login_failures where username = $1`, [
          username,
        ]);
        return { id: String(user.id), name: user.username };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        const email = profile?.email?.toLowerCase();
        return Boolean(
          profile?.email_verified && email && allowedEmails().includes(email),
        );
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        token.uid = `${account.provider}:${user.id}`;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.uid ?? token.sub ?? "";
      return session;
    },
  },
});
