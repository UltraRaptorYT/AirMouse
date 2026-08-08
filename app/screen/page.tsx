"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { supabase } from "@/lib/supabase/client";
import { generateRoomCode, getRoomChannel } from "@/lib/realtime/room";

type ConnectionStatus =
  | "creating"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

type CursorPosition = {
  x: number;
  y: number;
};

export default function ScreenPage() {
  const [roomCode, setRoomCode] = useState("");

  const [status, setStatus] = useState<ConnectionStatus>("creating");
  const [controllerUrl, setControllerUrl] = useState("");

  const [lastAction, setLastAction] = useState("Nothing yet");

  const [cursor, setCursor] = useState<CursorPosition>({
    x: 0,
    y: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  /*
   * Generate room code client-side.
   *
   * This prevents the hydration problem caused
   * by Math.random() generating different values
   * on the server and browser.
   */
  useEffect(() => {
    const code = generateRoomCode();

    setRoomCode(code);

    setCursor({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });

    setControllerUrl(`${window.location.origin}/controller?room=${code}`);
  }, []);

  /*
   * Connect the laptop to its Supabase room.
   */
  useEffect(() => {
    if (!roomCode) return;

    setStatus("connecting");

    const channel = getRoomChannel(roomCode);

    channelRef.current = channel;

    channel
      /*
       * Phone connected.
       */
      .on(
        "broadcast",
        {
          event: "controller-connected",
        },
        () => {
          console.log("Controller connected");

          setStatus("connected");
          setLastAction("Phone connected");
        },
      )

      /*
       * Phone disconnected.
       */
      .on(
        "broadcast",
        {
          event: "controller-disconnected",
        },
        () => {
          console.log("Controller disconnected");

          setStatus("waiting");

          setLastAction("Phone disconnected");
        },
      )

      /*
       * Phone orientation movement.
       *
       * Controller sends:
       *
       * {
       *   dx: number,
       *   dy: number
       * }
       */
      .on(
        "broadcast",
        {
          event: "move",
        },
        ({ payload }) => {
          const dx = Number(payload?.dx ?? 0);

          const dy = Number(payload?.dy ?? 0);

          setCursor((previous) => {
            const x = previous.x + dx;

            const y = previous.y + dy;

            return {
              x: Math.max(0, Math.min(window.innerWidth, x)),

              y: Math.max(0, Math.min(window.innerHeight, y)),
            };
          });
        },
      )

      /*
       * Left click.
       */
      .on(
        "broadcast",
        {
          event: "left-click",
        },
        () => {
          setCursor((current) => {
            const element = document.elementFromPoint(current.x, current.y);

            if (element instanceof HTMLElement) {
              console.log("Left click:", element);

              element.click();
            }

            setLastAction("Left click");

            return current;
          });
        },
      )

      /*
       * Right click.
       */
      .on(
        "broadcast",
        {
          event: "right-click",
        },
        () => {
          setCursor((current) => {
            const element = document.elementFromPoint(current.x, current.y);

            if (element) {
              element.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,

                  clientX: current.x,

                  clientY: current.y,

                  button: 2,
                  buttons: 2,
                }),
              );
            }

            setLastAction("Right click");

            return current;
          });
        },
      )

      /*
       * Recenter cursor.
       */
      .on(
        "broadcast",
        {
          event: "recenter",
        },
        () => {
          setCursor({
            x: window.innerWidth / 2,

            y: window.innerHeight / 2,
          });

          setLastAction("Cursor recentered");
        },
      )

      /*
       * Subscribe to room.
       */
      .subscribe((subscriptionStatus) => {
        console.log("Supabase:", subscriptionStatus);

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

  /*
   * Keep cursor inside screen if
   * browser is resized.
   */
  useEffect(() => {
    function handleResize() {
      setCursor((previous) => ({
        x: Math.max(0, Math.min(window.innerWidth, previous.x)),

        y: Math.max(0, Math.min(window.innerHeight, previous.y)),
      }));
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <>
      <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-xl space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-4xl font-bold tracking-tight">
              Air Mouse Screen
            </h1>

            <p className="text-muted-foreground">
              Enter this room code on your phone.
            </p>
          </div>

          {/* Room */}

          <Card>
            <CardHeader>
              <CardTitle>Room</CardTitle>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="flex flex-col items-center gap-5">
                {controllerUrl && (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <QRCodeSVG value={controllerUrl} size={200} level="M" />
                  </div>
                )}

                <div className="text-center">
                  <p className="mb-2 text-sm text-muted-foreground">
                    Scan QR code or enter room code
                  </p>

                  <div className="font-mono text-5xl font-bold tracking-[0.25em]">
                    {roomCode || "------"}
                  </div>
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
                  {status === "creating" && "Creating room..."}
                  {status === "connecting" && "Connecting..."}
                  {status === "waiting" && "Waiting for phone..."}
                  {status === "connected" && "Phone connected"}
                  {status === "error" && "Connection error"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Test area */}

          <Card>
            <CardHeader>
              <CardTitle>Cursor test</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Last action</p>

                <p className="mt-1 text-xl font-semibold">{lastAction}</p>

                <div className="mt-3 flex gap-5 font-mono text-xs text-muted-foreground">
                  <span>X: {Math.round(cursor.x)}</span>

                  <span>Y: {Math.round(cursor.y)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-20"
                  onClick={() => setLastAction("Button A clicked!")}
                >
                  Button A
                </Button>

                <Button
                  className="h-20"
                  variant="secondary"
                  onClick={() => setLastAction("Button B clicked!")}
                >
                  Button B
                </Button>

                <Button
                  className="h-20"
                  variant="outline"
                  onClick={() => setLastAction("Button C clicked!")}
                >
                  Button C
                </Button>

                <Button
                  className="h-20"
                  variant="destructive"
                  onClick={() => setLastAction("Button D clicked!")}
                >
                  Button D
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Virtual cursor */}

      <div
        className="pointer-events-none fixed z-[999999]"
        style={{
          left: cursor.x,
          top: cursor.y,
          transform: "translate(-4px, -4px)",
        }}
      >
        <div className="relative">
          <div className="size-7 rounded-full border-[3px] border-white bg-black shadow-xl" />

          <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
      </div>
    </>
  );
}
