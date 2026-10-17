"use client";

import { useState } from "react";
import {
  embedSrc,
  originalUrl,
  PLATFORM_LABEL,
  type Platform,
} from "@/lib/reels";

export type SharedReel = {
  platform: Platform;
  extId: string;
  title: string;
  author: string;
};

const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];

/** Narrow whatever came off the wire to a platform we know how to embed. */
export function asPlatform(p: string): Platform | null {
  return (PLATFORMS as string[]).includes(p) ? (p as Platform) : null;
}

/**
 * A reel inside a chat bubble. Shows a poster until tapped, then mounts the
 * platform's embed player. Only one card in a thread plays at a time.
 */
export default function ReelCard({
  reel,
  playing,
  onPlay,
}: {
  reel: SharedReel;
  playing: boolean;
  onPlay: () => void;
}) {
  const [feed, setFeed] = useState<"idle" | "adding" | "added" | "exists" | "error">(
    "idle",
  );

  // Goes through the normal add-a-link route, so it gets the same validation and limits.
  async function addToFeed() {
    if (feed === "adding") return;
    setFeed("adding");
    try {
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: originalUrl(reel.platform, reel.extId) }),
      });
      setFeed(res.ok ? "added" : res.status === 409 ? "exists" : "error");
    } catch {
      setFeed("error");
    }
  }

  // extId came from our reels table, which validated it with a strict regex.
  const poster =
    reel.platform === "youtube"
      ? `url(https://i.ytimg.com/vi/${reel.extId}/hqdefault.jpg)`
      : undefined;

  return (
    <div className="w-56 overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
      <div className="relative" style={{ aspectRatio: "9 / 16" }}>
        {playing ? (
          <iframe
            src={embedSrc(reel.platform, reel.extId, true)}
            title={reel.title || `${PLATFORM_LABEL[reel.platform]} reel`}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${reel.title || "reel"}`}
            className="absolute inset-0 flex items-center justify-center bg-cover bg-center"
            style={{
              backgroundImage: poster,
              backgroundColor: poster ? undefined : "#14171f",
            }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-xl text-white ring-1 ring-white/30 transition hover:bg-black/80">
              ▶
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 bg-white/5 px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs text-white/90">
            {reel.title || "Untitled"}
          </p>
          <p className="truncate text-[10px] text-white/40">
            {PLATFORM_LABEL[reel.platform]}
            {reel.author ? ` · ${reel.author}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={addToFeed}
            disabled={feed === "adding" || feed === "added" || feed === "exists"}
            className="text-[11px] text-indigo-300 transition hover:text-indigo-200 disabled:text-white/40"
          >
            {feed === "adding"
              ? "Adding..."
              : feed === "added"
                ? "In your feed"
                : feed === "exists"
                  ? "Already in feed"
                  : feed === "error"
                    ? "Retry"
                    : "+ Feed"}
          </button>
          <a
            href={originalUrl(reel.platform, reel.extId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-white/50 transition hover:text-white"
          >
            Open
          </a>
        </div>
      </div>
    </div>
  );
}
