"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Gamepad2,
  Keyboard,
  MonitorUp,
  MousePointer2,
  QrCode,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function HomePage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    router.push(`/room/${encodeURIComponent(code)}`);
  }

  return (
    <main className="light-mode game-shell min-h-dvh overflow-hidden bg-[#eef7f0] p-4 text-[#17211c] sm:p-6">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-6xl flex-col sm:min-h-[calc(100dvh-3rem)]">
        <header className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <span className="keep-white flex size-10 items-center justify-center rounded-2xl bg-[#e56b35] text-white shadow-[0_10px_30px_rgba(229,107,53,.2)]">
              <Gamepad2 className="size-5" />
            </span>
            <strong className="text-xl font-black tracking-[-.04em]">
              AirMouse
            </strong>
          </div>

          <Button
            variant="outline"
            className="rounded-xl border-black/10 bg-white text-[#17211c] hover:bg-[#edf4ef] hover:text-[#17211c]"
            onClick={() => router.push("/screen")}
          >
            <MonitorUp className="mr-1 size-4" />
            Host a game
          </Button>
        </header>

        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.08fr_.92fr]">
          <section>
            <span className="eyebrow">Multiplayer sorting game</span>
            <h1 className="mt-6 max-w-3xl text-balance text-5xl font-black leading-[.92] tracking-[-.055em] sm:text-7xl lg:text-[5.4rem]">
              Think fast.
              <br />
              Drag smart.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/55">
              Scan the host&apos;s QR code, use your phone as a motion
              controller, and race your friends to fly every answer into the
              right box.
            </p>

            <div className="mt-9 grid max-w-xl grid-cols-3 gap-3">
              {[
                [QrCode, "Scan"],
                [MousePointer2, "Sort"],
                [Smartphone, "Score"],
              ].map(([Icon, label], index) => {
                const StepIcon = Icon as typeof QrCode;
                return (
                  <div
                    key={label as string}
                    className="rounded-2xl border border-white/8 bg-white/[.035] p-4"
                  >
                    <div className="mb-5 flex items-center justify-between">
                      <StepIcon className="size-5 text-[#ff7c61]" />
                      <span className="font-mono text-xs text-white/20">
                        0{index + 1}
                      </span>
                    </div>
                    <p className="font-bold">{label as string}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="relative">
            <div className="absolute -inset-12 rounded-full bg-[#ff6b4a]/10 blur-3xl" />
            <div className="host-panel relative overflow-hidden p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-white/8">
                  <Keyboard className="size-5 text-white/65" />
                </span>
                <div>
                  <p className="font-bold">Can&apos;t scan the QR?</p>
                  <p className="text-sm text-white/40">
                    Join manually with the room code
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <label
                  htmlFor="room"
                  className="text-xs font-bold uppercase tracking-[.18em] text-white/40"
                >
                  Room code
                </label>
                <Input
                  id="room"
                  value={roomCode}
                  placeholder="A7KF2P"
                  maxLength={6}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-2.5 h-16 rounded-2xl border-black/10 bg-[#edf4ef] text-center font-mono text-2xl font-bold uppercase tracking-[.28em] text-[#17211c] placeholder:text-black/20 focus-visible:border-[#e56b35]/60 focus-visible:ring-[#e56b35]/15"
                  onChange={(event) =>
                    setRoomCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") joinRoom();
                  }}
                />
              </div>

              <Button
                className="keep-white mt-4 h-14 w-full rounded-2xl bg-[#e56b35] text-base font-black text-white shadow-[0_12px_30px_rgba(229,107,53,.18)] hover:bg-[#c95727]"
                disabled={roomCode.length !== 6}
                onClick={joinRoom}
              >
                Enter room
                <ArrowRight className="ml-1 size-4" />
              </Button>

              <div className="mt-7 border-t border-white/8 pt-6 text-center text-xs leading-relaxed text-white/30">
                If you can scan, use the QR on the host screen.
                <br />
                It takes you straight to your room.
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
