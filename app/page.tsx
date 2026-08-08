"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function HomePage() {
  const router = useRouter();

  const [roomCode, setRoomCode] = useState("");

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();

    if (!code) return;

    router.push(`/controller?room=${encodeURIComponent(code)}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Air Mouse</CardTitle>

            <CardDescription>
              Enter the room code shown on your laptop.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="room">Room code</Label>

              <Input
                id="room"
                value={roomCode}
                placeholder="A7KF2P"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="h-14 text-center font-mono text-2xl uppercase tracking-[0.25em]"
                onChange={(event) => {
                  setRoomCode(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    joinRoom();
                  }
                }}
              />
            </div>

            <Button
              className="h-12 w-full text-base"
              disabled={!roomCode.trim()}
              onClick={joinRoom}
            >
              Join Room
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
