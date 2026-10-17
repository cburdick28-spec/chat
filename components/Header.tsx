"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

const POLL_MS = 8000;

export default function Header({
  active,
  name,
  unread,
}: {
  active: "chat" | "reels";
  name: string;
  /** Pass the count in when the page already tracks it (the chat page does). */
  unread?: number;
}) {
  // Pages that don't track unread themselves (Reels) get a light poll so the dot still shows.
  const [polled, setPolled] = useState(0);
  const selfPolling = unread === undefined;

  useEffect(() => {
    if (!selfPolling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (!document.hidden) {
        try {
          const res = await fetch("/api/people", { cache: "no-store" });
          if (res.ok && !stopped) {
            const data = (await res.json()) as {
              people: { unread: number }[];
              groupUnread: number;
            };
            setPolled(
              data.groupUnread + data.people.reduce((a, p) => a + p.unread, 0),
            );
          }
        } catch {
          // try again next round
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [selfPolling]);

  const count = unread ?? polled;

  const tab = (key: "chat" | "reels", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active === key
          ? "bg-white/10 text-white"
          : "text-white/50 hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
      {key === "chat" && count > 0 && (
        <span
          aria-label={`${count} unread`}
          className="rounded-full bg-rose-500 px-1.5 text-[10px] leading-4 text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
      <nav className="flex items-center gap-1">
        {tab("chat", "/", "Chat")}
        {tab("reels", "/reels", "Reels")}
      </nav>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-white/40 sm:inline">{name}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md px-2.5 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
