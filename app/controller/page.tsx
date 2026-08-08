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

type Orientation = {
  alpha: number;
  beta: number;
  gamma: number;
};

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const SENSITIVITY = 6;
const DEAD_ZONE = 0.15;

export default function ControllerPage() {
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  const [motionEnabled, setMotionEnabled] = useState(false);

  const [orientation, setOrientation] = useState<Orientation>({
    alpha: 0,
    beta: 0,
    gamma: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  const previousOrientationRef = useRef<Orientation | null>(null);

  const motionActiveRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      setRoomCode(roomFromUrl.toUpperCase());
    }
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  async function connectToRoom() {
    const code = roomCode.trim().toUpperCase();

    if (!code) return;

    setStatus("connecting");
    setRoomCode(code);

    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = getRoomChannel(code);
    channelRef.current = channel;

    channel.subscribe(async (subscriptionStatus) => {
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

  async function disconnect() {
    motionActiveRef.current = false;
    setMotionEnabled(false);

    window.removeEventListener("deviceorientation", handleOrientation);

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

  async function sendEvent(
    event: string,
    payload: Record<string, unknown> = {},
  ) {
    const channel = channelRef.current;

    if (!channel || status !== "connected") {
      return;
    }

    await channel.send({
      type: "broadcast",
      event,
      payload,
    });
  }

  function normalizeAngleDelta(current: number, previous: number) {
    let delta = current - previous;

    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    return delta;
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    if (!motionActiveRef.current) return;

    const alpha = event.alpha ?? 0;
    const beta = event.beta ?? 0;
    const gamma = event.gamma ?? 0;

    const current = {
      alpha,
      beta,
      gamma,
    };

    setOrientation(current);

    const previous = previousOrientationRef.current;

    if (!previous) {
      previousOrientationRef.current = current;
      return;
    }

    const deltaYaw = normalizeAngleDelta(current.alpha, previous.alpha);

    const deltaPitch = current.beta - previous.beta;

    previousOrientationRef.current = current;

    let dx = deltaYaw * SENSITIVITY;
    let dy = deltaPitch * SENSITIVITY;

    if (Math.abs(dx) < DEAD_ZONE) {
      dx = 0;
    }

    if (Math.abs(dy) < DEAD_ZONE) {
      dy = 0;
    }

    if (dx === 0 && dy === 0) {
      return;
    }

    sendEvent("move", {
      dx,
      dy,
    });
  }

  async function enableMotion() {
    try {
      const OrientationEvent =
        DeviceOrientationEvent as DeviceOrientationEventWithPermission;

      if (typeof OrientationEvent.requestPermission === "function") {
        const permission = await OrientationEvent.requestPermission();

        if (permission !== "granted") {
          return;
        }
      }

      previousOrientationRef.current = null;
      motionActiveRef.current = true;
      setMotionEnabled(true);

      window.addEventListener("deviceorientation", handleOrientation);
    } catch (error) {
      console.error("Could not enable device orientation:", error);
    }
  }

  function disableMotion() {
    motionActiveRef.current = false;
    setMotionEnabled(false);

    previousOrientationRef.current = null;

    window.removeEventListener("deviceorientation", handleOrientation);
  }

  function recenter() {
    previousOrientationRef.current = null;

    sendEvent("recenter");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Air Mouse</h1>

          <p className="text-sm text-muted-foreground">
            Point your phone to move the cursor.
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
                disabled={status === "connected"}
                className="text-center font-mono text-xl uppercase tracking-widest"
                onChange={(event) =>
                  setRoomCode(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
              />
            </div>

            {status !== "connected" ? (
              <Button
                className="h-12 w-full"
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

            <p className="text-center text-sm text-muted-foreground">
              {status === "idle" && "Not connected"}

              {status === "connecting" && "Connecting..."}

              {status === "connected" && "Connected to laptop"}

              {status === "error" && "Connection failed"}
            </p>
          </CardContent>
        </Card>

        {status === "connected" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Motion control</CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                {!motionEnabled ? (
                  <Button
                    className="h-20 w-full text-lg"
                    onClick={enableMotion}
                  >
                    Enable Motion Control
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="h-20 w-full text-lg"
                    onClick={disableMotion}
                  >
                    Pause Motion
                  </Button>
                )}

                <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">Yaw</div>
                    <div>{orientation.alpha.toFixed(1)}</div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">Pitch</div>
                    <div>{orientation.beta.toFixed(1)}</div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">Roll</div>
                    <div>{orientation.gamma.toFixed(1)}</div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="h-14 w-full"
                  onClick={recenter}
                >
                  Recenter
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mouse buttons</CardTitle>
              </CardHeader>

              <CardContent>
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
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
