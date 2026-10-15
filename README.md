# chat

Private chat for friends. Next.js + Tailwind, Postgres (Neon), Auth.js. Live feel comes from short polling (every ~1.5s), which keeps it working on Vercel's serverless setup.

## Sign-in options

- **Username + password**, locked behind an invite code (`INVITE_CODE`). Works with zero third-party setup.
- **Google** (optional). Only emails listed in `ALLOWED_EMAILS` get in. The button only shows when the Google keys are set.

## Environment variables

Copy `.env.example` to `.env.local` for local dev. On Vercel, add these in Project Settings, Environment Variables.

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon, via the Vercel Marketplace). Empty in local dev = throwaway local DB in `.data/` |
| `AUTH_SECRET` | Random string that signs login cookies. `openssl rand -base64 32` |
| `INVITE_CODE` | Required to create a username/password account. Unset = sign-ups off |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | From Google Cloud Console (optional) |
| `ALLOWED_EMAILS` | Comma-separated Gmail addresses allowed to sign in with Google |

Tables are created automatically on first request.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in AUTH_SECRET and INVITE_CODE
npm run dev
```

## Google OAuth setup

1. Google Cloud Console, APIs & Services, Credentials, Create OAuth client ID, Web application.
2. Authorized redirect URI: `https://YOUR-DOMAIN/api/auth/callback/google` (add `http://localhost:3000/api/auth/callback/google` for local testing).
3. Put the Client ID and Secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, add friends' emails to `ALLOWED_EMAILS`, redeploy.

Use personal Gmail accounts. School-managed Google accounts usually block sign-in to unverified apps.

## Notes

- Login attempts are throttled per username (8 failures per 15 minutes), wrong invite codes are throttled (20 per 15 minutes, app-wide), and messages are rate limited per user.
- Bumping `AUTH_SECRET` signs everyone out.
