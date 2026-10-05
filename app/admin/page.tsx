"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, Trash2 } from "lucide-react";
import { leaderboardUrl } from "@/lib/realtime/leaderboard";

type ResetResult = {
  deletedEntries: number;
  deletedPhotos: number;
};

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResetResult | null>(null);

  async function clearLeaderboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation.trim() !== "CLEAR LEADERBOARD") return;

    const endpoint = leaderboardUrl("/admin/reset");
    if (!endpoint) {
      setError("The realtime Worker URL is not configured for this site.");
      return;
    }

    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirmation: confirmation.trim() }),
      });
      const body = (await response.json()) as ResetResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not clear the leaderboard.");
      setResult(body);
      setToken("");
      setConfirmation("");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Could not clear the leaderboard.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="game-shell min-h-dvh bg-[#eef7f0] p-4 text-[#17211c] sm:p-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-[#52645a] hover:bg-white"
        >
          <ArrowLeft className="size-4" /> Back to AirMouse
        </Link>

        <section className="host-panel mt-5 p-6 sm:p-9">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#c65324]">
            <ShieldAlert className="size-7" />
          </div>
          <p className="eyebrow mt-6">Admin controls</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Clear the leaderboard
          </h1>
          <p className="mt-3 leading-relaxed text-[#66736c]">
            This permanently removes every fastest-team score and its archived
            leaderboard photo. Shared photo download links are kept.
          </p>

          <form onSubmit={clearLeaderboard} className="mt-8 space-y-5">
            <label className="block space-y-2 text-sm font-bold">
              <span>Admin token</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={32}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="h-12 w-full rounded-xl border border-black/15 bg-white px-4 font-mono text-sm outline-none focus:border-[#e56b35] focus:ring-4 focus:ring-[#e56b35]/10"
                placeholder="Paste the Cloudflare Worker admin secret"
              />
              <span className="block font-normal text-[#66736c]">
                This token is sent only to the realtime Worker and is not saved.
              </span>
            </label>

            <label className="block space-y-2 text-sm font-bold">
              <span>Type CLEAR LEADERBOARD to confirm</span>
              <input
                type="text"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#e56b35] focus:ring-4 focus:ring-[#e56b35]/10"
                placeholder="CLEAR LEADERBOARD"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}
            {result && (
              <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                Cleared {result.deletedEntries} scores and {result.deletedPhotos} leaderboard photos.
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !token || confirmation.trim() !== "CLEAR LEADERBOARD"}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a93225] px-5 font-black text-white transition hover:bg-[#87261d] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 className="size-4" />
              {busy ? "Clearing…" : "Clear scores and leaderboard photos"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
