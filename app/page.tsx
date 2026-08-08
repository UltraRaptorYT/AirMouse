"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

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

export default function Home() {
  const [roomCode, setRoomCode] = useState("");

  const [status, setStatus] = useState<ConnectionStatus>("creating");

  const [lastAction, setLastAction] = useState("Nothing yet");

  const [cursor, setCursor] = useState<CursorPosition>({
    x: 0,
    y: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  /**
   * Generate the room code only after hydration.
   *
   * We DON'T do:
   *
   * useState(() => generateRoomCode())
   *
   * because generateRoomCode() uses Math.random(),
   * which would create a different value on the
   * server and client and cause hydration errors.
   */
  useEffect(() => {
    const code = generateRoomCode();

    setRoomCode(code);

    // Start cursor in centre of screen.
    setCursor({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }, []);

  /**
   * Connect laptop to the Supabase room.
   */
  useEffect(() => {
    if (!roomCode) {
      return;
    }

    setStatus("connecting");

    const channel = getRoomChannel(roomCode);

    channelRef.current = channel;

    channel
      /**
       * Phone joined.
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

      /**
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

      /**
       * Move virtual cursor.
       *
       * Phone sends:
       *
       * {
       *   dx: 20,
       *   dy: -10
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
            const nextX = previous.x + dx;
            const nextY = previous.y + dy;

            return {
              x: Math.max(0, Math.min(window.innerWidth, nextX)),

              y: Math.max(0, Math.min(window.innerHeight, nextY)),
            };
          });
        },
      )

      /**
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
              console.log("Left click target:", element);

              element.click();

              setLastAction(`Left clicked ${element.tagName.toLowerCase()}`);
            } else {
              setLastAction("Left click");
            }

            return current;
          });
        },
      )

      /**
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
              const event = new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,

                clientX: current.x,
                clientY: current.y,

                button: 2,
                buttons: 2,
              });

              element.dispatchEvent(event);

              console.log("Right click target:", element);
            }

            setLastAction("Right click");

            return current;
          });
        },
      )

      /**
       * Recenter virtual cursor.
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

      /**
       * Subscribe.
       */
      .subscribe((subscriptionStatus) => {
        console.log("Supabase subscription:", subscriptionStatus);

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

    /**
     * Cleanup when component unmounts
     * or roomCode changes.
     */
    return () => {
      supabase.removeChannel(channel);

      channelRef.current = null;
    };
  }, [roomCode]);

  /**
   * Keep cursor inside the viewport
   * when window gets resized.
   */
  useEffect(() => {
    function handleResize() {
      setCursor((previous) => ({
        x: Math.min(previous.x, window.innerWidth),
        y: Math.min(previous.y, window.innerHeight),
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
          {/* Header */}

          <div className="space-y-2 text-center">
            <h1 className="text-4xl font-bold tracking-tight">Air Mouse</h1>

            <p className="text-muted-foreground">
              Control this screen using your phone.
            </p>
          </div>

          {/* Connection */}

          <Card>
            <CardHeader>
              <CardTitle>Connect your phone</CardTitle>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Room code */}

              <div className="text-center">
                <p className="mb-2 text-sm text-muted-foreground">Room code</p>

                <div className="font-mono text-5xl font-bold tracking-[0.25em]">
                  {roomCode || "------"}
                </div>
              </div>

              {/* Status */}

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

                  {status === "connecting" && "Connecting to Supabase..."}

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
              {/* Current action */}

              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Last action</p>

                <p className="mt-1 text-xl font-semibold">{lastAction}</p>

                <div className="mt-3 flex gap-4 font-mono text-xs text-muted-foreground">
                  <span>x: {Math.round(cursor.x)}</span>

                  <span>y: {Math.round(cursor.y)}</span>
                </div>
              </div>

              {/* Buttons for cursor clicking test */}

              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-16"
                  onClick={() => {
                    setLastAction("Button A clicked!");
                  }}
                >
                  Button A
                </Button>

                <Button
                  className="h-16"
                  variant="secondary"
                  onClick={() => {
                    setLastAction("Button B clicked!");
                  }}
                >
                  Button B
                </Button>

                <Button
                  className="h-16"
                  variant="outline"
                  onClick={() => {
                    setLastAction("Button C clicked!");
                  }}
                >
                  Button C
                </Button>

                <Button
                  className="h-16"
                  variant="destructive"
                  onClick={() => {
                    setLastAction("Button D clicked!");
                  }}
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

          // Cursor hotspot is around top-left.
          transform: "translate(-3px, -3px)",
        }}
      >
        <div className="relative">
          {/* Main cursor circle */}

          <div className="size-6 rounded-full border-[3px] border-white bg-black shadow-lg" />

          {/* Tiny centre point */}

          <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
      </div>
    </>
  );
}
