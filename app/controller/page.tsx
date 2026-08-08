"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { supabase } from "@/lib/supabase/client";
import { getRoomChannel } from "@/lib/realtime/room";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export default function ControllerPage() {
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  const channelRef = useRef<RealtimeChannel | null>(null);

  async function connectToRoom() {
    const code = roomCode.trim().toUpperCase();

    if (!code) return;

    setRoomCode(code);
    setStatus("connecting");

    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = getRoomChannel(code);

    channelRef.current = channel;

    channel.subscribe(async (subscriptionStatus) => {
      console.log("Controller subscription:", subscriptionStatus);

      if (subscriptionStatus === "SUBSCRIBED") {
        setStatus("connected");

        await channel.send({
          type: "broadcast",
          event: "controller-connected",
          payload: {},
        });
      }

      if (
        subscriptionStatus === "CHANNEL_ERROR" ||
        subscriptionStatus === "TIMED_OUT"
      ) {
        setStatus("error");
      }
    });
  }

  async function sendEvent(event: string) {
    const channel = channelRef.current;

    if (!channel || status !== "connected") {
      return;
    }

    await channel.send({
      type: "broadcast",
      event,
      payload: {},
    });
  }

  async function disconnect() {
    const channel = channelRef.current;

    if (channel) {
      await channel.send({
        type: "broadcast",
        event: "controller-disconnected",
        payload: {},
      });

      await supabase.removeChannel(channel);
    }

    channelRef.current = null;
    setStatus("idle");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      setRoomCode(roomFromUrl.toUpperCase());
    }
  }, []);

  useEffect(() => {
    return () => {
      const channel = channelRef.current;

      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Air Mouse</h1>

          <p className="text-sm text-muted-foreground">
            Use your phone as a controller.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connect to laptop</CardTitle>
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
                className="text-center font-mono text-xl uppercase tracking-widest"
                disabled={status === "connected"}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
              />
            </div>

            {status !== "connected" ? (
              <Button
                className="h-12 w-full text-base"
                disabled={status === "connecting" || roomCode.length === 0}
                onClick={connectToRoom}
              >
                {status === "connecting" ? "Connecting..." : "Connect"}
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={disconnect}>
                Disconnect
              </Button>
            )}

            <ConnectionStatus status={status} />
          </CardContent>
        </Card>

        {status === "connected" && (
          <Card>
            <CardHeader>
              <CardTitle>Mouse controls</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-24 text-lg"
                  onClick={() => sendEvent("left-click")}
                >
                  Left Click
                </Button>

                <Button
                  variant="secondary"
                  className="h-24 text-lg"
                  onClick={() => sendEvent("right-click")}
                >
                  Right Click
                </Button>
              </div>

              <Button
                variant="outline"
                className="h-14 w-full"
                onClick={() => sendEvent("recenter")}
              >
                Recenter
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function ConnectionStatus({ status }: { status: ConnectionStatus }) {
  const label = {
    idle: "Not connected",
    connecting: "Connecting...",
    connected: "Connected to laptop",
    error: "Connection failed",
  }[status];

  const dotClass = {
    idle: "bg-muted-foreground",
    connecting: "bg-yellow-500",
    connected: "bg-green-500",
    error: "bg-red-500",
  }[status];

  return (
    <div className="flex items-center justify-center gap-2">
      <div className={`size-2.5 rounded-full ${dotClass}`} />

      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
