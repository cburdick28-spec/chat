"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmojiPicker from "@/components/EmojiPicker";
import Header from "@/components/Header";
import ReelCard, { asPlatform, type SharedReel } from "@/components/ReelCard";
import { isEmojiOnly } from "@/lib/emoji";

type Msg = {
  id: number;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
  reel: (Omit<SharedReel, "platform"> & { platform: string }) | null;
};

type Person = { id: string; name: string; unread: number };

const POLL_MS = 1500;
const POLL_HIDDEN_MS = 5000;
const PEOPLE_POLL_MS = 4000;
const PEOPLE_POLL_HIDDEN_MS = 15000;

function hueFor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Chat({ me }: { me: { id: string; name: string } }) {
  const router = useRouter();
  // null = the everyone chat, otherwise the id of the person you're messaging.
  const [peer, setPeer] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [groupUnread, setGroupUnread] = useState(0);

  // Keep the list of people (and unread counts) fresh.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      let delay = document.hidden ? PEOPLE_POLL_HIDDEN_MS : PEOPLE_POLL_MS;
      try {
        const res = await fetch("/api/people", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok && !stopped) {
          const data = (await res.json()) as {
            people: Person[];
            groupUnread: number;
          };
          setPeople(data.people);
          setGroupUnread(data.groupUnread);
        }
      } catch {
        delay = 10000;
      }
      if (!stopped) timer = setTimeout(tick, delay);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router]);

  const peerName = peer ? (people.find((p) => p.id === peer)?.name ?? "them") : null;
  // The open conversation is being read, so don't badge it.
  const shown = (id: string | null, n: number) => (id === peer ? 0 : n);
  const totalUnread =
    shown(null, groupUnread) + people.reduce((a, p) => a + shown(p.id, p.unread), 0);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <Header active="chat" name={me.name} unread={totalUnread} />

      <div className="thin-scroll flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 px-3 py-2">
        <Chip
          label="Everyone"
          active={peer === null}
          unread={shown(null, groupUnread)}
          onClick={() => setPeer(null)}
        />
        {people.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            hue={hueFor(p.id)}
            active={peer === p.id}
            unread={shown(p.id, p.unread)}
            onClick={() => setPeer(p.id)}
          />
        ))}
        {people.length === 0 && (
          <span className="self-center px-1 text-xs text-white/30">
            Friends show up here once they&apos;ve signed in.
          </span>
        )}
      </div>

      <Thread
        key={peer ?? "all"}
        me={me}
        peer={peer}
        peerName={peerName}
      />
    </div>
  );
}

function Chip({
  label,
  active,
  unread,
  hue,
  onClick,
}: {
  label: string;
  active: boolean;
  unread: number;
  hue?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-indigo-400 bg-indigo-500/30 text-white"
          : "border-white/10 text-white/60 hover:bg-white/5"
      }`}
    >
      {hue !== undefined && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: `hsl(${hue} 70% 65%)` }}
        />
      )}
      {label}
      {unread > 0 && (
        <span className="rounded-full bg-rose-500 px-1.5 text-[10px] leading-4 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

function Thread({
  me,
  peer,
  peerName,
}: {
  me: { id: string; name: string };
  peer: string | null;
  peerName: string | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastId = useRef(0);
  const readUpTo = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // auto-scroll only if the reader is at the bottom

  const withParam = peer ? `with=${encodeURIComponent(peer)}` : "";

  const merge = useCallback((incoming: Msg[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].sort((a, b) => a.id - b.id);
    });
    lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
  }, []);

  // Polling loop
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      let delay = document.hidden ? POLL_HIDDEN_MS : POLL_MS;
      try {
        const qs = [lastId.current ? `after=${lastId.current}` : "", withParam]
          .filter(Boolean)
          .join("&");
        const res = await fetch(`/api/messages${qs ? `?${qs}` : ""}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { messages: Msg[] };
          if (!stopped) {
            merge(data.messages);
            setLoaded(true);
          }
          // More waiting? Come right back instead of sleeping.
          if (data.messages.length >= 100) delay = 0;
        }
      } catch {
        delay = 4000; // offline or server hiccup, back off a bit
      }
      if (!stopped) timer = setTimeout(tick, delay);
    }

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [merge, router, withParam]);

  // Tell the server how far you've read, so the unread badge clears.
  const newestId = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => {
    if (!newestId || newestId <= readUpTo.current || document.hidden) return;
    readUpTo.current = newestId;
    fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ with: peer ?? "all", upTo: newestId }),
    }).catch(() => {
      readUpTo.current = 0;
    });
  }, [newestId, peer]);

  // Keep pinned to the bottom when new messages land
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, playing]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    if (next.length > 2000) return;
    setText(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setPickerOpen(false); // close now, not on reply, or a slow reply would shut a picker you just reopened
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, to: peer }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send that.");
        return;
      }
      setText("");
      stick.current = true;
      merge([data.message as Msg]);
    } catch {
      setError("Couldn't reach the server. Your message is still in the box.");
    } finally {
      setSending(false);
    }
  }

  const isDm = peer !== null;

  return (
    <>
      <div
        ref={listRef}
        onScroll={onScroll}
        className="thin-scroll flex-1 space-y-0.5 overflow-y-auto px-4 py-4"
      >
        {loaded && messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-white/30">
            {isDm
              ? `This is the start of your chat with ${peerName ?? "them"}.`
              : "Nobody's said anything yet. Be first."}
          </p>
        )}

        {messages.map((m, i) => {
          const mine = m.authorId === me.id;
          const prev = messages[i - 1];
          const showName = !prev || prev.authorId !== m.authorId;
          const big = isEmojiOnly(m.body);
          const platform = m.reel ? asPlatform(m.reel.platform) : null;
          return (
            <div
              key={m.id}
              className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"} ${showName ? "pt-3" : ""}`}
            >
              {showName && !mine && !isDm && (
                <span
                  className="mb-0.5 px-1 text-xs font-medium"
                  style={{ color: `hsl(${hueFor(m.authorId)} 70% 70%)` }}
                >
                  {m.author}
                </span>
              )}
              {m.reel && platform && (
                <ReelCard
                  reel={{ ...m.reel, platform }}
                  playing={playing === m.id}
                  onPlay={() => setPlaying(m.id)}
                />
              )}
              {m.body && (
                <div
                  title={timeLabel(m.createdAt)}
                  className={
                    big
                      ? "max-w-[80%] whitespace-pre-wrap break-words px-1 text-4xl leading-tight"
                      : `max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          mine
                            ? "bg-indigo-500 text-white"
                            : "bg-white/8 text-white/90"
                        }`
                  }
                >
                  {m.body}
                </div>
              )}
              {(showName || messages[i + 1]?.authorId !== m.authorId) && (
                <span className="mt-0.5 px-1 text-[10px] text-white/30">
                  {timeLabel(m.createdAt)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-white/10 p-3"
      >
        {error && (
          <p role="alert" className="mb-2 px-1 text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="relative flex items-end gap-2">
          {pickerOpen && (
            <EmojiPicker
              onPick={insertEmoji}
              onClose={() => setPickerOpen(false)}
            />
          )}
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Emoji"
            aria-expanded={pickerOpen}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl transition hover:bg-white/10"
          >
            😊
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={isDm ? `Message ${peerName ?? ""}`.trim() : "Message everyone"}
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/60"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="h-[42px] rounded-xl bg-indigo-500 px-4 text-sm font-medium transition hover:bg-indigo-400 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </>
  );
}
