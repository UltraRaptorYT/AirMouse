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
  const [camera, setCamera] = useState<"off" | "opening" | "on">("off");
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopCamera() {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamera("off");
    setReady(false);
  }

  async function openCamera() {
    const request = ++requestRef.current;
    setError("");
    setPhoto(null);
    setCamera("opening");
    setReady(false);
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
      if (request === requestRef.current) setCamera("on");
    } catch {
      if (request !== requestRef.current) return;
      stopCamera();
      setError("Could not open the camera. Allow camera access and check that a camera is connected, then try again.");
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(640, video.videoWidth);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    const context = canvas.getContext("2d");
    if (!context) { setError("Could not capture the photo. Please try again."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    let snapshot = "";
    for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
      snapshot = canvas.toDataURL("image/jpeg", quality);
      if (snapshot.length <= MAX_TEAM_PHOTO_LENGTH) break;
    }
    if (snapshot.length > MAX_TEAM_PHOTO_LENGTH) {
      setError("The photo is too large. Try again with a simpler background.");
      return;
    }
    setPhoto(snapshot);
    stopCamera();
  }

  return (
    <section className="mt-6 w-full max-w-lg rounded-2xl border border-[#e56b35]/25 bg-[#fff1e7] p-5">
      <h2 className="flex items-center justify-center gap-2 text-xl font-black"><Camera className="size-5" /> Top {rank} finish — team photo!</h2>
      <p className="mt-2 text-sm text-white/50">Take a photo on this host device for your team&apos;s leaderboard entry.</p>
      <video ref={videoRef} autoPlay muted playsInline onCanPlay={() => setReady(true)}
        className={`mt-4 aspect-[4/3] w-full rounded-xl bg-black object-contain ${camera === "off" ? "hidden" : ""}`} />
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
            <Button disabled={!ready || camera !== "on"} onClick={capture}><Camera className="size-4" /> {camera === "opening" ? "Opening camera…" : "Take photo"}</Button>
            <Button variant="outline" onClick={stopCamera}>Cancel</Button>
          </>
        ) : <Button onClick={() => void openCamera()}><Camera className="size-4" /> Open camera</Button>}
      </div>
    </section>
  );
}
