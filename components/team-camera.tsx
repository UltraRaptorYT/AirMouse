"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Check, Download, RotateCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { MAX_TEAM_PHOTO_LENGTH } from "@/lib/realtime/leaderboard";

export type PhotoSaveState = { status: "idle" | "saving" | "saved" | "error"; error?: string; downloadUrl?: string };

function waitForVideoFrame(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timeout = 0;
    function cleanup() {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    }
    function handleReady() {
      if (video.videoWidth === 0) return;
      cleanup();
      resolve();
    }
    function handleError() {
      cleanup();
      reject(new Error("The camera preview could not be loaded."));
    }

    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The camera took too long to start. Please try again."));
    }, 8_000);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

export function TeamCamera({ rank, saveState, onSave, autoStart = false, autoSave = false }: {
  rank?: number;
  saveState: PhotoSaveState;
  onSave: (photo: string) => void;
  autoStart?: boolean;
  autoSave?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const countdownTimerRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);
  const autoSaveRequestedRef = useRef(false);
  const [camera, setCamera] = useState<"off" | "opening" | "on">("off");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const photoDownloadUrl = saveState.downloadUrl;

  useEffect(() => () => {
    requestRef.current += 1;
    autoStartedRef.current = false;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopCamera = useCallback(() => {
    requestRef.current += 1;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("off");
    setCountdown(null);
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    try {
      if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) {
        throw new Error("The camera is not ready. Please try again.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture the photo. Please try again.");
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const watermarkSize = Math.max(14, Math.round(canvas.width * 0.035));
      const watermarkHeight = watermarkSize + Math.round(canvas.width * 0.035);
      context.fillStyle = "rgba(0, 0, 0, 0.58)";
      context.fillRect(0, canvas.height - watermarkHeight, canvas.width, watermarkHeight);
      context.fillStyle = "#ffffff";
      context.font = `700 ${watermarkSize}px system-ui, sans-serif`;
      context.textBaseline = "middle";
      context.fillText("AirMouse  •  Team Photo", Math.round(canvas.width * 0.025), canvas.height - watermarkHeight / 2);

      let snapshot = "";
      for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
        snapshot = canvas.toDataURL("image/jpeg", quality);
        if (snapshot.length <= MAX_TEAM_PHOTO_LENGTH) break;
      }
      if (snapshot.length > MAX_TEAM_PHOTO_LENGTH) {
        throw new Error("The photo is too large. Try again with a simpler background.");
      }
      autoSaveRequestedRef.current = false;
      setPhoto(snapshot);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Could not capture the photo. Please try again.");
    } finally {
      stopCamera();
    }
  }, [stopCamera]);

  const startCountdown = useCallback((request: number) => {
    function tick(remaining: number) {
      if (request !== requestRef.current) return;
      setCountdown(remaining);
      countdownTimerRef.current = window.setTimeout(() => {
        if (request !== requestRef.current) return;
        if (remaining > 1) tick(remaining - 1);
        else capture();
      }, 1_000);
    }
    tick(5);
  }, [capture]);

  const openCamera = useCallback(async () => {
    const request = ++requestRef.current;
    setError("");
    setPhoto(null);
    setCamera("opening");
    setCountdown(null);
    try {
      if (!window.isSecureContext) throw new Error("Camera preview requires HTTPS or localhost.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("The camera preview is not ready. Please try again.");
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      await waitForVideoFrame(video);
      if (request !== requestRef.current) return;
      setCamera("on");
      startCountdown(request);
    } catch (cameraError) {
      if (request !== requestRef.current) return;
      stopCamera();
      setError(cameraError instanceof Error
        ? cameraError.message
        : "Could not open the camera. Allow camera access and check that a camera is connected, then try again.");
    }
  }, [startCountdown, stopCamera]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void openCamera();
  }, [autoStart, openCamera]);

  useEffect(() => {
    if (!autoSave || !photo || saveState.status !== "idle" || autoSaveRequestedRef.current) return;
    autoSaveRequestedRef.current = true;
    onSave(photo);
  }, [autoSave, onSave, photo, saveState.status]);

  return (
    <section className="w-full rounded-2xl border border-[#e56b35]/25 bg-[#fff1e7] p-4 text-left sm:p-5">
      <h2 className="flex items-center justify-center gap-2 text-xl font-black">
        <Camera className="size-5" /> {rank ? `Top ${rank} finish — team photo!` : "Team photo"}
      </h2>
      <p className="mt-2 text-center text-sm font-semibold text-[#5b7068]">
        Get ready — the camera starts now and takes the photo after 5, 4, 3, 2, 1.
      </p>

      <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-xl bg-[#17231f]">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover transition-opacity ${camera === "off" || photo ? "opacity-0" : "opacity-100"}`}
        />
        {photo ? (
          <Image src={photo} alt="Your team photo preview" width={640} height={480} unoptimized className="absolute inset-0 h-full w-full object-cover" />
        ) : camera === "off" ? (
          <div className="keep-white absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/75">
            <Camera className="size-10" aria-hidden="true" />
            <span className="text-sm font-bold">Your camera preview will appear here</span>
          </div>
        ) : (
          <div role="status" aria-live="assertive" aria-atomic="true" className="keep-white pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-transparent text-white">
            {countdown !== null ? (
              <>
                <strong className="text-7xl font-black drop-shadow-lg sm:text-8xl">{countdown}</strong>
                <span className="rounded-full bg-black/50 px-4 py-1.5 text-sm font-bold">Get ready!</span>
              </>
            ) : (
              <span className="rounded-full bg-black/50 px-4 py-2 text-sm font-bold">Opening camera…</span>
            )}
          </div>
        )}
      </div>

      {(error || saveState.error) && <p role="alert" className="mt-3 text-sm text-[#a44a22]">{error || saveState.error}</p>}
      {photo && photoDownloadUrl && saveState.status === "saved" && (
        <div className="mt-4 rounded-2xl border border-[#16865c]/20 bg-white p-4 text-center">
          <p className="text-sm font-bold text-[#17211c]">Scan to download your watermarked team photo</p>
          <div className="mx-auto mt-3 w-fit rounded-xl border border-black/5 bg-white p-2">
            <QRCodeSVG value={photoDownloadUrl} size={180} level="M" bgColor="#ffffff" fgColor="#17211c" />
          </div>
          <a href={photoDownloadUrl} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#16865c] px-4 py-2 text-sm font-bold text-white hover:bg-[#116b49]">
            <Download className="size-4" /> Download on this device
          </a>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {saveState.status === "saved" ? (
          <p role="status" className="flex items-center gap-2 font-bold text-[#087653]"><Check className="size-5" /> {rank ? "Team photo saved!" : "Photo ready to download!"}</p>
        ) : photo ? (
          <>
            <Button variant="outline" disabled={saveState.status === "saving"} onClick={() => void openCamera()}><RotateCcw className="size-4" /> Retake</Button>
            {saveState.status === "saving" ? (
              <p role="status" className="font-bold text-[#5b7068]">Saving photo…</p>
            ) : saveState.status === "error" ? (
              <Button onClick={() => onSave(photo)}>Retry photo save</Button>
            ) : !rank ? (
              <p role="status" className="flex items-center gap-2 font-bold text-[#087653]"><Check className="size-5" /> Photo captured!</p>
            ) : <Button onClick={() => onSave(photo)}>Save team photo</Button>}
          </>
        ) : camera !== "off" ? (
          <Button variant="outline" onClick={stopCamera}>Cancel</Button>
        ) : (
          <Button onClick={() => void openCamera()}><Camera className="size-4" /> Start photo countdown</Button>
        )}
      </div>
    </section>
  );
}
