"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_TEAM_PHOTO_LENGTH } from "@/lib/realtime/leaderboard";

export type PhotoSaveState = { status: "idle" | "saving" | "saved" | "error"; error?: string };

export function TeamCamera({ rank, saveState, onSave }: {
  rank: number;
  saveState: PhotoSaveState;
  onSave: (photo: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const countdownTimerRef = useRef<number | null>(null);
  const [camera, setCamera] = useState<"off" | "opening" | "on">("off");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    requestRef.current += 1;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopCamera() {
    requestRef.current += 1;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("off");
    setCountdown(null);
  }

  function startCountdown(request: number) {
    function tick(remaining: number) {
      // Ignore callbacks from a cancelled camera session or an unmounted component.
      if (request !== requestRef.current) return;
      setCountdown(remaining);
      countdownTimerRef.current = window.setTimeout(() => {
        if (request !== requestRef.current) return;
        if (remaining > 0) tick(remaining - 1);
        else capture();
      }, remaining > 0 ? 1_000 : 750);
    }
    tick(3);
  }

  async function openCamera() {
    const request = ++requestRef.current;
    setError("");
    setPhoto(null);
    setCamera("opening");
    setCountdown(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (request === requestRef.current) {
        setCamera("on");
        startCountdown(request);
      }
    } catch {
      if (request !== requestRef.current) return;
      stopCamera();
      setError("Could not open the camera. Allow camera access and check that a camera is connected, then try again.");
    }
  }

  function capture() {
    const video = videoRef.current;
    try {
      if (!video?.videoWidth || !video.videoHeight || video.readyState < 2)
        throw new Error("The camera is not ready. Please try again.");
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture the photo. Please try again.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let snapshot = "";
      for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
        snapshot = canvas.toDataURL("image/jpeg", quality);
        if (snapshot.length <= MAX_TEAM_PHOTO_LENGTH) break;
      }
      if (snapshot.length > MAX_TEAM_PHOTO_LENGTH)
        throw new Error("The photo is too large. Try again with a simpler background.");
      setPhoto(snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not capture the photo. Please try again.");
    } finally {
      stopCamera();
    }
  }

  return (
    <section className="mt-6 w-full max-w-lg rounded-2xl border border-[#e56b35]/25 bg-[#fff1e7] p-5">
      <h2 className="flex items-center justify-center gap-2 text-xl font-black"><Camera className="size-5" /> Top {rank} finish — team photo!</h2>
      <p className="mt-2 text-sm text-white/50">Gather your team! Start the camera and we&apos;ll count down 3, 2, 1 — pose! Your photo is taken automatically.</p>
      <div className={`relative mt-4 overflow-hidden rounded-xl bg-black ${camera === "off" ? "hidden" : ""}`}>
        <video ref={videoRef} autoPlay muted playsInline
          className="aspect-[4/3] w-full object-contain" />
        <div role="status" aria-live="assertive" aria-atomic="true"
          className="keep-white pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 text-white">
          {countdown !== null ? (
            <>
              <strong className="text-7xl font-black drop-shadow-lg sm:text-8xl">{countdown === 0 ? "Pose!" : countdown}</strong>
              <span className="rounded-full bg-black/50 px-4 py-1.5 text-sm font-bold">{countdown === 0 ? "Hold that smile…" : "Get ready!"}</span>
            </>
          ) : <span className="rounded-full bg-black/50 px-4 py-2 text-sm font-bold">Opening camera…</span>}
        </div>
      </div>
      {photo && <Image src={photo} alt="Your team photo preview" width={640} height={480} unoptimized className="mt-4 max-h-72 w-full rounded-xl object-contain" />}
      {(error || saveState.error) && <p role="alert" className="mt-3 text-sm text-[#a44a22]">{error || saveState.error}</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {saveState.status === "saved" ? (
          <p role="status" className="flex items-center gap-2 font-bold text-[#087653]"><Check className="size-5" /> Team photo saved!</p>
        ) : photo ? (
          <>
            <Button variant="outline" disabled={saveState.status === "saving"} onClick={() => void openCamera()}><RotateCcw className="size-4" /> Retake</Button>
            <Button disabled={saveState.status === "saving"} onClick={() => onSave(photo)}>{saveState.status === "saving" ? "Saving…" : "Save team photo"}</Button>
          </>
        ) : camera !== "off" ? (
          <>
            <Button variant="outline" onClick={stopCamera}>Cancel</Button>
          </>
        ) : <Button onClick={() => void openCamera()}><Camera className="size-4" /> Start photo countdown</Button>}
      </div>
    </section>
  );
}
