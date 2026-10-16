"use client";

import { useEffect, useRef, useState } from "react";

const CATEGORIES: { id: string; icon: string; label: string; emojis: string }[] = [
  {
    id: "smileys",
    icon: "😀",
    label: "Smileys",
    emojis:
      "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖",
  },
  {
    id: "hands",
    icon: "👍",
    label: "Hands",
    emojis:
      "👍 👎 👊 ✊ 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🫶 🫰 🫵 🧠 👀 👅",
  },
  {
    id: "hearts",
    icon: "❤️",
    label: "Hearts & symbols",
    emojis:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊 ✅ ❌ ❓ ❗ 💤",
  },
  {
    id: "animals",
    icon: "🐶",
    label: "Animals",
    emojis:
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🦈 🐬 🐳 🐊 🦖",
  },
  {
    id: "food",
    icon: "🍕",
    label: "Food",
    emojis:
      "🍎 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥑 🍕 🍔 🍟 🌭 🌮 🌯 🍗 🥓 🍳 🍞 🧀 🍣 🍜 🍝 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🥤 🍺",
  },
  {
    id: "play",
    icon: "🏀",
    label: "Sports & stuff",
    emojis:
      "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🥊 🏆 🥇 🎮 🕹️ 🎲 🎯 🎰 🎸 🎧 🎤 🚗 🏎️ ✈️ 🚀 💻 📱 💰 💎",
  },
];

const RECENT_KEY = "chat:recentEmojis";

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string").slice(0, 16)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(emoji: string) {
  try {
    const next = [emoji, ...loadRecents().filter((e) => e !== emoji)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked, recents just won't stick
  }
}

export default function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("smileys");
  const [recents, setRecents] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client
    setRecents(loadRecents());
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const showRecents = tab === "recent";
  const cat = CATEGORIES.find((c) => c.id === tab) ?? CATEGORIES[0];
  const list = showRecents ? recents : cat.emojis.split(" ");

  function pick(e: string) {
    saveRecent(e);
    setRecents(loadRecents());
    onPick(e);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      className="absolute bottom-full left-0 z-20 mb-2 w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-white/10 bg-[#12151c] shadow-2xl"
    >
      <div className="flex gap-0.5 border-b border-white/10 p-1.5">
        {recents.length > 0 && (
          <TabButton
            active={showRecents}
            label="Recent"
            onClick={() => setTab("recent")}
          >
            🕘
          </TabButton>
        )}
        {CATEGORIES.map((c) => (
          <TabButton
            key={c.id}
            active={tab === c.id}
            label={c.label}
            onClick={() => setTab(c.id)}
          >
            {c.icon}
          </TabButton>
        ))}
      </div>

      <div className="thin-scroll grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-1.5">
        {list.length === 0 && (
          <p className="col-span-8 py-6 text-center text-xs text-white/30">
            Nothing here yet.
          </p>
        )}
        {list.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => pick(e)}
            className="flex h-9 items-center justify-center rounded-md text-xl transition hover:bg-white/10"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 flex-1 items-center justify-center rounded-md text-base transition ${
        active ? "bg-white/10" : "opacity-60 hover:bg-white/5 hover:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}
