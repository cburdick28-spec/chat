"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  embedSrc,
  originalUrl,
  PLATFORM_LABEL,
  type Platform,
} from "@/lib/reels";
import { MAX_INTERESTS, TOPIC_GROUPS } from "@/lib/topics";

type Reel = {
  id: number;
  platform: Platform;
  extId: string;
  title: string;
  author: string;
  auto: boolean;
  addedBy: string | null;
  mine: boolean;
  createdAt: string;
  liked: boolean;
  likes: number;
};

type Person = { id: string; name: string; unread: number };

const DOT: Record<Platform, string> = {
  youtube: "bg-red-500",
  tiktok: "bg-cyan-400",
  instagram: "bg-fuchsia-500",
};

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/60";

export default function Reels() {
  const router = useRouter();
  const [reels, setReels] = useState<Reel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [autoFeed, setAutoFeed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [forYouOpen, setForYouOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);

  const [sendFor, setSendFor] = useState<Reel | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [sendNote, setSendNote] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const jumpToTop = useRef(false);
  const busy = useRef(false);
  const emptyRetries = useRef(0);
  const reported = useRef(new Set<number>());

  const load = useCallback(
    async (cursorParam?: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await fetch(
          `/api/reels?limit=10${cursorParam ? `&cursor=${encodeURIComponent(cursorParam)}` : ""}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          reels: Reel[];
          nextCursor: string | null;
          autoFeed: boolean;
        };
        setReels((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...data.reels.filter((r) => !seen.has(r.id))];
        });
        // A first-page refetch must not rewind a cursor we've already advanced past.
        setCursor((c) => (cursorParam || c === null ? data.nextCursor : c));
        setAutoFeed(data.autoFeed);
      } catch {
        // offline, the next scroll will try again
      } finally {
        busy.current = false;
        setLoaded(true);
      }
    },
    [router],
  );

  useEffect(() => {
    // Fetching the first page on mount; state is only set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Empty feed with auto-updates on: the first fill may still be running, so check back a few times.
  useEffect(() => {
    if (!loaded || reels.length > 0 || !autoFeed || emptyRetries.current >= 3) {
      return;
    }
    const t = setTimeout(() => {
      emptyRetries.current += 1;
      load();
    }, 6000);
    return () => clearTimeout(t);
  }, [loaded, reels.length, autoFeed, load]);

  // Track which reel is on screen
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // A slide leaving the view also fires (at 60% and falling), so check the ratio.
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActive(Number((e.target as HTMLElement).dataset.index));
          }
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reels.length]);

  // Endless scroll: fetch the next page when you get near the end
  useEffect(() => {
    if (cursor && reels.length > 0 && active >= reels.length - 3) {
      // Next page fetch; state is only set after the await.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load(cursor);
    }
  }, [active, cursor, reels.length, load]);

  // Reached the end of everything for now: check back, the server keeps pulling in fresh ones.
  useEffect(() => {
    if (!autoFeed || cursor !== null || reels.length === 0) return;
    if (active < reels.length - 1) return;
    const t = setInterval(() => load(), 15000);
    return () => clearInterval(t);
  }, [autoFeed, cursor, active, reels.length, load]);

  // Tell the server a reel was seen once it has been on screen a moment, so it isn't served again.
  const activeId = reels[active]?.id;
  useEffect(() => {
    if (activeId === undefined || reported.current.has(activeId)) return;
    const t = setTimeout(() => {
      reported.current.add(activeId);
      fetch("/api/reels/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [activeId] }),
      }).catch(() => reported.current.delete(activeId));
    }, 1500);
    return () => clearTimeout(t);
  }, [activeId]);

  // After you add a reel, show it: wait for the new slide to render, then jump to the top.
  useEffect(() => {
    if (jumpToTop.current) {
      jumpToTop.current = false;
      scroller.current?.scrollTo({ top: 0 });
    }
  }, [reels]);

  // Arrow keys / j / k to step through on desktop
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const dir =
        e.key === "ArrowDown" || e.key === "j"
          ? 1
          : e.key === "ArrowUp" || e.key === "k"
            ? -1
            : 0;
      const root = scroller.current;
      if (!dir || !root) return;
      const next = Math.min(Math.max(active + dir, 0), reels.length - 1);
      e.preventDefault();
      root.scrollTo({ top: next * root.clientHeight, behavior: "smooth" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, reels.length]);

  async function openForYou() {
    setAddOpen(false);
    setSendFor(null);
    const next = !forYouOpen;
    setForYouOpen(next);
    if (!next) return;
    setInterestError(null);
    try {
      const res = await fetch("/api/reels/interests", { cache: "no-store" });
      if (res.ok) setPicked(((await res.json()) as { topics: string[] }).topics);
    } catch {
      // keep whatever is selected
    }
  }

  function toggleTopic(t: string) {
    setInterestError(null);
    setPicked((p) =>
      p.includes(t)
        ? p.filter((x) => x !== t)
        : p.length >= MAX_INTERESTS
          ? p
          : [...p, t],
    );
  }

  async function saveInterests() {
    if (savingInterests) return;
    setSavingInterests(true);
    setInterestError(null);
    try {
      const res = await fetch("/api/reels/interests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: picked }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setInterestError(data.error ?? "Couldn't save that.");
        return;
      }
      setForYouOpen(false);
      // Start the feed over so new picks apply; seen reels stay out of it.
      setReels([]);
      setCursor(null);
      setActive(0);
      emptyRetries.current = 0;
      scroller.current?.scrollTo({ top: 0 });
      load();
    } catch {
      setInterestError("Couldn't reach the server.");
    } finally {
      setSavingInterests(false);
    }
  }

  async function addReel(e: React.FormEvent) {
    e.preventDefault();
    if (adding || !url.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, caption }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.error ?? "Couldn't add that.");
        return;
      }
      jumpToTop.current = true;
      setReels((prev) => [data.reel as Reel, ...prev]);
      setActive(0);
      setUrl("");
      setCaption("");
      setAddOpen(false);
    } catch {
      setAddError("Couldn't reach the server.");
    } finally {
      setAdding(false);
    }
  }

  // Optimistic heart: flip it now, roll back if the server says no.
  async function toggleLike(id: number) {
    const target = reels.find((r) => r.id === id);
    if (!target) return;
    const liked = !target.liked;
    const patch = (l: boolean, n: number) =>
      setReels((prev) =>
        prev.map((r) => (r.id === id ? { ...r, liked: l, likes: n } : r)),
      );
    patch(liked, Math.max(0, target.likes + (liked ? 1 : -1)));
    try {
      const res = await fetch("/api/reels/like", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, liked }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        patch(target.liked, target.likes);
        return;
      }
      const data = (await res.json()) as { likes: number };
      patch(liked, data.likes);
    } catch {
      patch(target.liked, target.likes);
    }
  }

  async function openSend(reel: Reel) {
    setAddOpen(false);
    setForYouOpen(false);
    setSendFor(reel);
    setSendNote("");
    setSendError(null);
    try {
      const res = await fetch("/api/people", { cache: "no-store" });
      if (res.ok) setPeople(((await res.json()) as { people: Person[] }).people);
    } catch {
      // the Everyone option still works
    }
  }

  async function sendReel(to: Person | null) {
    if (!sendFor || sendingTo) return;
    setSendingTo(to?.id ?? "all");
    setSendError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reelId: sendFor.id,
          to: to?.id ?? null,
          body: sendNote,
        }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? "Couldn't send that.");
        return;
      }
      setSendFor(null);
      setToast(`Sent to ${to?.name ?? "everyone"}`);
      setTimeout(() => setToast(null), 2500);
    } catch {
      setSendError("Couldn't reach the server.");
    } finally {
      setSendingTo(null);
    }
  }

  async function remove(id: number) {
    try {
      const res = await fetch(`/api/reels?id=${id}`, { method: "DELETE" });
      if (res.ok) setReels((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // leave it in the list, user can retry
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <p className="text-xs text-white/40">
          {reels.length > 0
            ? `${Math.min(active + 1, reels.length)}${cursor ? "" : " · end for now"}`
            : " "}
        </p>
        <div className="flex gap-2">
          {autoFeed && (
            <button
              onClick={openForYou}
              aria-expanded={forYouOpen}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10"
            >
              For you
            </button>
          )}
          <button
            onClick={() => {
              setForYouOpen(false);
              setSendFor(null);
              setAddOpen((o) => !o);
            }}
            aria-expanded={addOpen}
            className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium transition hover:bg-indigo-400"
          >
            {addOpen ? "Close" : "+ Add reel"}
          </button>
        </div>
      </div>

      {forYouOpen && (
        <div className="thin-scroll absolute inset-x-2 top-11 z-20 max-h-[70%] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#12151c] p-3 shadow-2xl">
          <p className="text-xs text-white/50">
            Pick up to {MAX_INTERESTS} things you like. You&apos;ll see more of them,
            mixed with random stuff so it never gets stale. This isn&apos;t linked to
            your YouTube account.
          </p>
          {TOPIC_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-white/30">
                {g.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.topics.map((t) => {
                  const on = picked.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTopic(t)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        on
                          ? "border-indigo-400 bg-indigo-500/30 text-white"
                          : "border-white/10 text-white/60 hover:bg-white/5"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {interestError && (
            <p role="alert" className="text-xs text-rose-400">
              {interestError}
            </p>
          )}
          <button
            onClick={saveInterests}
            disabled={savingInterests}
            className="sticky bottom-0 w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium shadow-[0_-8px_12px_#12151c] transition hover:bg-indigo-400 disabled:opacity-40"
          >
            {savingInterests ? "Saving..." : "Save and refresh my feed"}
          </button>
        </div>
      )}

      {addOpen && (
        <form
          onSubmit={addReel}
          className="absolute inset-x-2 top-11 z-20 space-y-2 rounded-xl border border-white/10 bg-[#12151c] p-3 shadow-2xl"
        >
          <input
            className={inputClass}
            placeholder="Paste a YouTube Shorts, TikTok or Instagram reel link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            inputMode="url"
            autoCapitalize="none"
          />
          <input
            className={inputClass}
            placeholder="Caption (optional)"
            value={caption}
            maxLength={140}
            onChange={(e) => setCaption(e.target.value)}
          />
          {addError && (
            <p role="alert" className="text-xs text-rose-400">
              {addError}
            </p>
          )}
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium transition hover:bg-indigo-400 disabled:opacity-40"
          >
            {adding ? "Adding..." : "Add to feed"}
          </button>
        </form>
      )}

      {sendFor && (
        <div className="thin-scroll absolute inset-x-2 top-11 z-20 max-h-[70%] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-[#12151c] p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-white/50">
              Send &quot;{sendFor.title || "this reel"}&quot; to...
            </p>
            <button
              onClick={() => setSendFor(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <input
            className={inputClass}
            placeholder="Add a message (optional)"
            value={sendNote}
            maxLength={500}
            onChange={(e) => setSendNote(e.target.value)}
          />
          {sendError && (
            <p role="alert" className="text-xs text-rose-400">
              {sendError}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={sendingTo !== null}
              onClick={() => sendReel(null)}
              className="rounded-full border border-indigo-400 bg-indigo-500/30 px-3 py-1.5 text-xs font-medium transition hover:bg-indigo-500/50 disabled:opacity-40"
            >
              {sendingTo === "all" ? "Sending..." : "Everyone"}
            </button>
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={sendingTo !== null}
                onClick={() => sendReel(p)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-40"
              >
                {sendingTo === p.id ? "Sending..." : p.name}
              </button>
            ))}
          </div>
          {people.length === 0 && (
            <p className="text-[11px] text-white/30">
              Friends show up here once they&apos;ve signed in.
            </p>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-12 z-30 flex justify-center"
        >
          <span className="rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
            {toast}
          </span>
        </div>
      )}

      <div
        ref={scroller}
        // Anchoring would keep the old reel in view when a new one is inserted above it.
        style={{ overflowAnchor: "none" }}
        className="thin-scroll min-h-0 flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-contain"
      >
        {loaded && reels.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
            <p className="text-sm text-white/60">
              {autoFeed ? "Pulling in fresh Shorts..." : "No reels yet."}
            </p>
            <p className="text-xs text-white/30">
              Hit &quot;Add reel&quot; and paste a link to start the feed.
            </p>
          </div>
        )}

        {reels.map((r, i) => (
          <Slide
            key={r.id}
            reel={r}
            index={i}
            live={i === active}
            onRemove={remove}
            onLike={toggleLike}
            onSend={openSend}
          />
        ))}
      </div>
    </div>
  );
}

function Slide({
  reel,
  index,
  live,
  onRemove,
  onLike,
  onSend,
}: {
  reel: Reel;
  index: number;
  live: boolean;
  onRemove: (id: number) => void;
  onLike: (id: number) => void;
  onSend: (reel: Reel) => void;
}) {
  // extId already passed a strict regex server-side, so this is safe to inline.
  const poster =
    reel.platform === "youtube"
      ? `url(https://i.ytimg.com/vi/${reel.extId}/hqdefault.jpg)`
      : undefined;

  return (
    <section
      data-index={index}
      className="flex h-full snap-start snap-always flex-col px-2 pb-2"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10"
          style={{ height: "100%", aspectRatio: "9 / 16", maxWidth: "100%" }}
        >
          <div
            className="absolute inset-0 flex flex-col items-center justify-end gap-1 bg-cover bg-center p-4 text-center"
            style={{
              backgroundImage: poster,
              backgroundColor: poster ? undefined : "#14171f",
            }}
          >
            <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">
              {live ? "Loading..." : "Scroll here to play"}
            </span>
          </div>
          {live && (
            <iframe
              key={reel.id}
              src={embedSrc(reel.platform, reel.extId, true)}
              title={reel.title || `${PLATFORM_LABEL[reel.platform]} reel`}
              className="absolute inset-0 h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-start justify-between gap-3 px-1 pt-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-white/50">
            <span className={`h-2 w-2 rounded-full ${DOT[reel.platform]}`} />
            <span className="truncate">
              {PLATFORM_LABEL[reel.platform]}
              {reel.author ? ` · ${reel.author}` : ""}
            </span>
          </div>
          <p className="line-clamp-1 text-sm text-white/90">
            {reel.title || "Untitled"}
          </p>
          <p className="text-[11px] text-white/30">
            {reel.auto ? "auto-picked" : `added by ${reel.addedBy ?? "someone"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onLike(reel.id)}
            aria-pressed={reel.liked}
            aria-label={reel.liked ? "Unlike" : "Like"}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm transition hover:bg-white/5 ${
              reel.liked ? "text-rose-400" : "text-white/50 hover:text-white"
            }`}
          >
            {reel.liked ? "♥" : "♡"}
            {reel.likes > 0 && (
              <span className="text-xs tabular-nums">{reel.likes}</span>
            )}
          </button>
          <button
            onClick={() => onSend(reel)}
            className="rounded-md px-2 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            Send
          </button>
          <a
            href={originalUrl(reel.platform, reel.extId)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-2 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            Open
          </a>
          {reel.mine && (
            <button
              onClick={() => onRemove(reel.id)}
              className="rounded-md px-2 py-1 text-xs text-rose-300/70 transition hover:bg-white/5 hover:text-rose-300"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
