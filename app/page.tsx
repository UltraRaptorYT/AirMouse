"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { supabase } from "@/lib/supabase/client";
import { generateRoomCode, getRoomChannel } from "@/lib/realtime/room";

type ConnectionStatus = "connecting" | "waiting" | "connected" | "error";

export default function Home() {
  const [roomCode] = useState(() => generateRoomCode());

  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const [lastAction, setLastAction] = useState<string>("Nothing yet");

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const channel = getRoomChannel(roomCode);

    channelRef.current = channel;

    channel
      .on("broadcast", { event: "controller-connected" }, () => {
        console.log("Phone connected");

        setStatus("connected");
        setLastAction("Phone connected");
      })
      .on("broadcast", { event: "controller-disconnected" }, () => {
        setStatus("waiting");
        setLastAction("Phone disconnected");
      })

      .on("broadcast", { event: "recenter" }, () => {
        setLastAction("Recenter requested");
      })

      .on("broadcast", { event: "left-click" }, () => {
        console.log("Left click received");

        setLastAction("Left click");
      })

      .on("broadcast", { event: "right-click" }, () => {
        console.log("Right click received");

        setLastAction("Right click");
      })

      .on("broadcast", { event: "move" }, ({ payload }) => {
        console.log("Move:", payload);

        setLastAction(`Move ${payload.dx}, ${payload.dy}`);
      })

      .subscribe((subscriptionStatus) => {
        console.log("Supabase status:", subscriptionStatus);

        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("waiting");
        }

        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setStatus("error");
        }
      });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Air Mouse</h1>

          <p className="text-muted-foreground">
            Control this screen using your phone.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connect your phone</CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="text-center">
              <p className="mb-2 text-sm text-muted-foreground">Room code</p>

              <div className="font-mono text-5xl font-bold tracking-[0.25em]">
                {roomCode}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2">
              <div
                className={`size-3 rounded-full ${
                  status === "connected"
                    ? "bg-green-500"
                    : status === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500"
                }`}
              />

              <span className="text-sm">
                {status === "connecting" && "Connecting to Supabase..."}

                {status === "waiting" && "Waiting for phone..."}

                {status === "connected" && "Phone connected"}

                {status === "error" && "Connection error"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test events</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-sm text-muted-foreground">Last action</p>

              <p className="mt-1 text-xl font-semibold">{lastAction}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => setLastAction("Button A clicked")}>
                Button A
              </Button>

              <Button
                variant="secondary"
                onClick={() => setLastAction("Button B clicked")}
              >
                Button B
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
