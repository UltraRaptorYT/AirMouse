"use client";

import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

const inputClass = "h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#e56b35] focus:ring-4 focus:ring-[#e56b35]/10";

export default function AdminLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      window.location.reload();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800">Admin access is not configured. Set <code>ADMIN_PASSWORD</code> in the server environment.</p>;

  return (
    <form onSubmit={login} className="max-w-xl space-y-4">
      <label className="block space-y-2 text-sm font-bold" htmlFor="admin-password">
        <span>Admin password</span>
        <input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} placeholder="Enter the configured password" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={busy || !password} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#24794d] px-5 font-black text-white transition hover:bg-[#1c633e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24794d] disabled:cursor-wait disabled:opacity-55">
        <LockKeyhole className="size-4" /> {busy ? "Checking password…" : "Unlock question builder"}
      </button>
      <p className="text-sm leading-relaxed text-[#66736c]">Your access stays active for up to 8 hours on this browser.</p>
    </form>
  );
}
