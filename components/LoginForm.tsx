"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

type Props = {
  googleEnabled: boolean;
  urlError: "denied" | "other" | null;
};

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/60";

export default function LoginForm({ googleEnabled, urlError }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError === "denied"
      ? "That Google account isn't on the friends list."
      : urlError === "other"
        ? "Couldn't sign you in. Try again."
        : null,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, invite }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Couldn't create the account.");
          return;
        }
      }

      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });
      if (!result || result.error) {
        setError("Wrong username or password.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network hiccup. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl">
      <h1 className="text-2xl font-semibold tracking-tight">chat</h1>
      <p className="mt-1 text-sm text-white/50">Friends only. Come on in.</p>

      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="mt-6 w-full rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3 text-xs text-white/30">
            <div className="h-px flex-1 bg-white/10" />
            or
            <div className="h-px flex-1 bg-white/10" />
          </div>
        </>
      )}

      <form
        onSubmit={onSubmit}
        className={googleEnabled ? "space-y-3" : "mt-6 space-y-3"}
      >
        <input
          className={inputClass}
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className={inputClass}
          placeholder="Password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mode === "signup" && (
          <input
            className={inputClass}
            placeholder="Invite code"
            autoComplete="off"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            required
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-rose-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-500 px-3 py-2.5 text-sm font-medium transition hover:bg-indigo-400 disabled:opacity-50"
        >
          {busy ? "One sec..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="mt-4 w-full text-center text-xs text-white/50 hover:text-white/80"
      >
        {mode === "signin"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
