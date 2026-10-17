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
| `YOUTUBE_API_KEY` | Turns on the endless auto-picked Shorts (optional, see Reels) |

Tables are created automatically on first request.

## Messages

The chat has an **Everyone** room plus private one-on-one messages. Tap a friend's name in the row above the message box to open your DM with them; a red number shows unread messages (also on the Chat tab, even while you're on Reels). Friends appear in that row after they've signed in once. Private messages only ever load for the two people in them.

## Sharing reels

Hit **Send** under any reel to drop it into a DM or the Everyone room as a playable card, with an optional note. The card shows a poster until tapped, then plays right in the chat. The reel is copied into the message, so it keeps working even if someone removes it from the feed later.

## Links in chat, and pasting piles of links

Paste a YouTube Shorts, TikTok or Instagram link into any message (Everyone or a DM) and it turns into a playable card. If the message is only the link you just get the card; any other text stays as a normal bubble. Short TikTok links (`vm.tiktok.com`) are followed once to find the real video. Each card has a **+ Feed** button that adds the reel to your feed (it says "Already in feed" if it's there).

"+ Add reel" takes one link or a whole pile (up to 10 at once, matching the 10-per-10-minutes limit). Paste a block of text and it picks out the reel links and skips the rest.

TikTok is link-only on purpose: TikTok has no public API for browsing a feed (their Research API is for approved researchers, and the Display API only reads the videos of a TikTok user who signs in with TikTok), and scraping it breaks their terms. Embeds of specific links are the supported route.

## Hearts train "For you"

The heart under each reel is a signal, not just a counter. Hearting reels of a topic pulls that topic forward in your feed (up to a cap, so it never takes over), and the next YouTube refresh searches your hearted topics, so the feed drifts toward what you actually like. Your "For you" picks still work and stack with hearts. Hearts only teach topics for auto-picked Shorts; pasted links have no topic.

## Emojis

Tap the smiley next to the message box. Recents are remembered per device, and a message that's only a few emoji shows up big with no bubble.

## Reels

The Reels tab is a vertical scroll feed (YouTube Shorts, TikTok, Instagram) that plays inside the app using each platform's official embed player. Only the reel on screen is loaded.

- **Pasted links:** anyone signed in can hit "+ Add reel" and paste a YouTube Shorts, TikTok or Instagram reel link. Links are parsed down to a platform + ID and the embed URL is rebuilt from that, never from the raw link. You can remove your own reels.
- **Everyone gets their own feed.** Each person's order is a personal shuffle, and anything you've scrolled past is skipped for you only. If you run out, it loops back through the oldest ones while new ones load. Links a friend adds in the last day jump to the front for everyone else.
- **Endless auto-picked Shorts:** set `YOUTUBE_API_KEY`. Whenever someone's unseen pile gets low, the server pulls a fresh batch aimed at them: one search from their "For you" picks plus random discovery from a ~70-topic pool (random sort order and age window each time, so results keep changing). Nothing reads anyone's YouTube account or watch history.
- **Free quota:** YouTube allows 10,000 units a day and a search costs 100, so searches are capped at `YT_DAILY_SEARCHES` (default 80, roughly 1,000+ new Shorts a day). When the cap hits, the feed keeps working from what's stored and picks up again the next day. `REELS_MIN_REFRESH_MINUTES` (default 8) limits how often one person can trigger a refresh. `REEL_QUERIES` adds extra discovery topics.
- **Why not auto-pull TikTok/Instagram too?** They have no public API for browsing a feed, and scraping or re-hosting their videos breaks their terms. Embeds of specific links are the supported route.
- Some creators turn embedding off, and those reels will show an error in the player. The "Open" link goes to the original.

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
