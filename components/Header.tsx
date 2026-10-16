"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function Header({
  active,
  name,
}: {
  active: "chat" | "reels";
  name: string;
}) {
  const tab = (key: "chat" | "reels", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active === key
          ? "bg-white/10 text-white"
          : "text-white/50 hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
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
