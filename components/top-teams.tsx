"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Trophy, Users, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { challenges } from "@/lib/game/questions";
import { leaderboardUrl, rankTeams } from "@/lib/realtime/leaderboard";
import type { LeaderboardEntry, LeaderboardPayload } from "@/lib/realtime/types";

export function TeamPhoto({ entry, compact = false }: { entry: LeaderboardEntry; compact?: boolean }) {
  const [showDownload, setShowDownload] = useState(false);
  const photoPath = `/photos/${encodeURIComponent(entry.id)}`;
  const src = entry.hasPhoto ? leaderboardUrl(photoPath) : null;
  const downloadUrl = entry.hasPhoto ? leaderboardUrl(`${photoPath}/download`) : null;
  const size = compact ? "h-9 w-11 rounded-lg" : "h-12 w-14 rounded-xl sm:h-16 sm:w-20";
  useEffect(() => {
    if (!showDownload) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setShowDownload(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showDownload]);
  return (
    <>
      {src ? (
        compact ? (
          <Image src={src} alt={`${entry.teamName} team photo`} width={96} height={72}
            unoptimized className={`${size} shrink-0 object-cover`} />
        ) : (
          <button type="button" onClick={() => setShowDownload(true)}
            className="group relative shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#44d79b]"
            aria-label={`Show QR code to download ${entry.teamName}'s photo`}>
            <Image src={src} alt={`${entry.teamName} team photo`} width={96} height={72}
              unoptimized className={`${size} object-cover`} />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 rounded-b-xl bg-black/75 px-1 py-1 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <Download className="size-3" /> QR download
            </span>
          </button>
        )
      ) : (
        <span className={`${size} flex shrink-0 items-center justify-center bg-[#edf4ef] text-[#16865c]`}>
          <Users className={compact ? "size-5" : "size-7"} />
        </span>
      )}
      {showDownload && downloadUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowDownload(false);
        }}>
          <section role="dialog" aria-modal="true" aria-label="Download team photo"
            className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center text-[#17211c] shadow-2xl">
            <button type="button" onClick={() => setShowDownload(false)}
              className="absolute right-3 top-3 rounded-full p-2 text-[#5b7068] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#16865c]"
              aria-label="Close QR code"><X className="size-5" /></button>
            <h2 className="pr-8 text-left text-xl font-black">Download team photo</h2>
            <p className="mt-2 text-sm text-[#5b7068]">Scan this QR code with your phone to download {entry.teamName}&apos;s photo.</p>
            <div className="mx-auto mt-5 w-fit rounded-2xl border border-black/5 bg-white p-3">
              <QRCodeSVG value={downloadUrl} size={220} level="M" bgColor="#ffffff" fgColor="#17211c" />
            </div>
            <a href={downloadUrl} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#16865c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#116b49]">
              <Download className="size-4" /> Download on this device
            </a>
          </section>
        </div>
      )}
    </>
  );
}

export function TopTeams({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="host-panel p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-xl font-black">
        <Trophy className="size-5 text-[#e56b35]" /> Top 3 teams · 排名前三的队伍
      </h2>
      <p className="mt-1 text-sm text-white/55">All-time fastest teams · 每项挑战的历史前三名</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {challenges.map((challenge) => {
          const teams = rankTeams(entries.filter((entry) => entry.challengeId === challenge.id)).slice(0, 3);
          const challengeNumber = challenge.number === 1 ? "一" : "二";
          const challengeTitle = challenge.language === "zh"
            ? `${challenge.label} · Chinese Challenge ${challenge.number}`
            : `${challenge.label} · 英文挑战${challengeNumber}`;
          return (
            <div key={challenge.id} className="min-w-0 rounded-xl bg-white/[.03] p-3">
              <h3 className="text-sm font-black">{challengeTitle}</h3>
              <p className="mb-2 text-[11px] text-white/40">{challenge.source}</p>
              {teams.length === 0 ? (
                <p className="rounded-lg border border-dashed border-black/10 p-3 text-sm text-white/55">No times yet · 暂无成绩，来争取第一名！</p>
              ) : (
                <ol className="space-y-1.5">
                  {teams.map((entry, index) => {
                    const seconds = Math.ceil(entry.timeMs / 1_000);
                    return (
                      <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-black/5 bg-white p-2">
                        <strong className="w-3 shrink-0 text-xs text-[#c65324]">{index + 1}</strong>
                        <TeamPhoto entry={entry} compact />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold" title={entry.teamName}>{entry.teamName}</p>
                          <p className="text-[10px] text-white/40">{entry.playerCount} {entry.playerCount === 1 ? "player" : "players"}</p>
                        </div>
                        <strong className="shrink-0 font-mono text-xs">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong>
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
  const [status, setStatus] = useState("Loading top teams… · 正在加载队伍排名…");
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
        if (!controller.signal.aborted) setStatus("Top teams are temporarily unavailable. Retrying shortly… · 排名暂不可用，稍后重试…");
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
