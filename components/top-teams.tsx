"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Trophy, Users } from "lucide-react";
import { challenges } from "@/lib/game/questions";
import { leaderboardUrl, rankTeams } from "@/lib/realtime/leaderboard";
import type { LeaderboardEntry, LeaderboardPayload } from "@/lib/realtime/types";

export function TeamPhoto({ entry }: { entry: LeaderboardEntry }) {
  const src = entry.hasPhoto
    ? leaderboardUrl(`/photos/${encodeURIComponent(entry.id)}`)
    : null;
  return src ? (
    <Image src={src} alt={`${entry.teamName} team photo`} width={96} height={72}
      unoptimized className="h-12 w-14 shrink-0 rounded-xl object-cover sm:h-16 sm:w-20" />
  ) : (
    <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl bg-[#edf4ef] text-[#16865c] sm:h-16 sm:w-20">
      <Users className="size-7" />
    </span>
  );
}

export function TopTeams({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="host-panel p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-2xl font-black">
        <Trophy className="size-6 text-[#e56b35]" /> Top 3 teams
      </h2>
      <p className="mt-1 text-sm text-white/45">All-time fastest teams · top three per challenge</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {challenges.map((challenge) => {
          const teams = rankTeams(entries.filter((entry) => entry.challengeId === challenge.id)).slice(0, 3);
          return (
            <div key={challenge.id} className="min-w-0 rounded-2xl bg-white/[.03] p-3 sm:p-4">
              <h3 className="font-black">{challenge.label}</h3>
              <p className="mb-3 text-xs text-white/40">{challenge.source}</p>
              {teams.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/10 p-5 text-sm text-white/40">No times yet — be the first team!</p>
              ) : (
                <ol className="space-y-2">
                  {teams.map((entry, index) => {
                    const seconds = Math.ceil(entry.timeMs / 1_000);
                    return (
                      <li key={entry.id} className="flex items-center gap-2 rounded-xl border border-black/5 bg-white p-2 sm:gap-3 sm:p-3">
                        <strong className="w-5 shrink-0 text-[#c65324]">{index + 1}</strong>
                        <TeamPhoto entry={entry} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold" title={entry.teamName}>{entry.teamName}</p>
                          <p className="text-xs text-white/40">{entry.playerCount} players</p>
                        </div>
                        <strong className="font-mono">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomeTopTeams() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState("Loading top teams…");
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const url = leaderboardUrl();
        if (!url) throw new Error("Leaderboard unavailable");
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Leaderboard unavailable");
        const data: LeaderboardPayload = await response.json();
        if (!Array.isArray(data.entries)) throw new Error("Invalid leaderboard");
        setEntries(data.entries);
        setStatus("");
      } catch {
        if (!controller.signal.aborted) setStatus("Top teams are temporarily unavailable. Retrying shortly…");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return (
    <div className="pb-6">
      {status && <p role="status" className="mb-3 text-sm text-white/45">{status}</p>}
      <TopTeams entries={entries} />
    </div>
  );
}
