"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Check, Download, RotateCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { MAX_TEAM_PHOTO_LENGTH } from "@/lib/realtime/leaderboard";

export type PhotoSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  error?: string;
  downloadUrl?: string;
};

function waitForVideoFrame(video: HTMLVideoElement) {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0
  ) {
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

function loadWatermarkLogo() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const logo = new window.Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () =>
      reject(new Error("The watermark logo could not be loaded."));
    logo.src = "/BWM%20Logo.png";
  });
}

export function TeamCamera({
  rank,
  language = "en",
  saveState,
  onSave,
  autoStart = false,
  autoSave = false,
}: {
  rank?: number;
  language?: "en" | "zh";
  saveState: PhotoSaveState;
  onSave: (photo: string) => void;
  autoStart?: boolean;
  autoSave?: boolean;
}) {
  const isChinese = language === "zh";
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

  useEffect(
    () => () => {
      requestRef.current += 1;
      autoStartedRef.current = false;
      if (countdownTimerRef.current !== null)
        window.clearTimeout(countdownTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const stopCamera = useCallback(() => {
    requestRef.current += 1;
    if (countdownTimerRef.current !== null)
      window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("off");
    setCountdown(null);
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    try {
      if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) {
        throw new Error("The camera is not ready. Please try again.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(1280, video.videoWidth);
      canvas.height = Math.round(
        (canvas.width * video.videoHeight) / video.videoWidth,
      );
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Could not capture the photo. Please try again.");
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const logo = await loadWatermarkLogo();
      const footerHeight = Math.max(54, Math.round(canvas.width * 0.12));
      const footerTop = canvas.height - footerHeight;
      context.fillStyle = "#fff8d8";
      context.fillRect(0, footerTop, canvas.width, footerHeight);
      context.fillStyle = "#f6e48a";
      context.beginPath();
      context.moveTo(0, footerTop + Math.round(footerHeight * 0.08));
      context.quadraticCurveTo(
        canvas.width * 0.48,
        footerTop - Math.round(footerHeight * 0.04),
        canvas.width,
        footerTop + Math.round(footerHeight * 0.08),
      );
      context.lineTo(canvas.width, canvas.height);
      context.lineTo(0, canvas.height);
      context.closePath();
      context.fill();

      const logoSize = Math.min(
        footerHeight - 10,
        Math.round(canvas.width * 0.12),
      );
      const logoX = Math.round(canvas.width * 0.025);
      const logoY = footerTop + Math.round((footerHeight - logoSize) / 2);
      context.drawImage(logo, logoX, logoY, logoSize, logoSize);

      const watermarkX = logoX + logoSize + Math.round(canvas.width * 0.025);
      const watermarkWidth =
        canvas.width - watermarkX - Math.round(canvas.width * 0.05);
      context.fillStyle = "#145642";
      context.textBaseline = "middle";
      context.textAlign = "left";
      context.font = `700 ${Math.max(11, Math.round(footerHeight * 0.18))}px system-ui, sans-serif`;
      context.fillText(
        "MRD 2026 Lamrim:",
        watermarkX,
        footerTop + footerHeight * 0.23,
        watermarkWidth,
      );
      context.font = `700 ${Math.max(11, Math.round(footerHeight * 0.21))}px system-ui, sans-serif`;
      context.fillText(
        "Rely on the Excellent Teachers",
        watermarkX,
        footerTop + footerHeight * 0.51,
        watermarkWidth,
      );
      context.font = `700 ${Math.max(11, Math.round(footerHeight * 0.18))}px system-ui, sans-serif`;
      context.fillText(
        "亿师恩 2026：广论亲近善知识",
        watermarkX,
        footerTop + footerHeight * 0.79,
        watermarkWidth,
      );

      let snapshot = "";
      for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
        snapshot = canvas.toDataURL("image/jpeg", quality);
        if (snapshot.length <= MAX_TEAM_PHOTO_LENGTH) break;
      }
      if (snapshot.length > MAX_TEAM_PHOTO_LENGTH) {
        throw new Error(
          "The photo is too large. Try again with a simpler background.",
        );
      }
      autoSaveRequestedRef.current = false;
      setPhoto(snapshot);
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Could not capture the photo. Please try again.",
      );
    } finally {
      stopCamera();
    }
  }, [stopCamera]);

  const startCountdown = useCallback(
    (request: number) => {
      function tick(remaining: number) {
        if (request !== requestRef.current) return;
        setCountdown(remaining);
        countdownTimerRef.current = window.setTimeout(() => {
          if (request !== requestRef.current) return;
          if (remaining > 1) tick(remaining - 1);
          else void capture();
        }, 1_000);
      }
      tick(5);
    },
    [capture],
  );

  const openCamera = useCallback(async () => {
    const request = ++requestRef.current;
    setError("");
    setPhoto(null);
    setCamera("opening");
    setCountdown(null);
    try {
      if (!window.isSecureContext)
        throw new Error("Camera preview requires HTTPS or localhost.");
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 960 },
        },
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
      setError(
        cameraError instanceof Error
          ? cameraError.message
          : "Could not open the camera. Allow camera access and check that a camera is connected, then try again.",
      );
    }
  }, [startCountdown, stopCamera]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void openCamera();
  }, [autoStart, openCamera]);

  useEffect(() => {
    if (
      !autoSave ||
      !photo ||
      saveState.status !== "idle" ||
      autoSaveRequestedRef.current
    )
      return;
    autoSaveRequestedRef.current = true;
    onSave(photo);
  }, [autoSave, onSave, photo, saveState.status]);

  return (
    <section className="grid w-full min-w-0 gap-5 rounded-2xl border border-[#e56b35]/25 bg-[#fff1e7] p-4 text-left sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
      <div className="min-w-0">
        <h2 className="flex items-center justify-center gap-2 text-xl font-black">
          <Camera className="size-5" />{" "}
          {isChinese
            ? rank
              ? `第 ${rank} 名合影`
              : "队伍合影"
            : rank
              ? `Top ${rank} finish — team photo!`
              : "Team photo"}
        </h2>
        <p className="mt-2 text-center text-sm font-semibold text-[#5b7068]">
          {isChinese
            ? "准备好，摄像头即将启动，并在倒数 5、4、3、2、1 后拍照。"
            : "Get ready — the camera starts now and takes the photo after 5, 4, 3, 2, 1."}
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
            <Image
              src={photo}
              alt={isChinese ? "队伍合影预览" : "Your team photo preview"}
              width={1280}
              height={960}
              unoptimized
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : camera === "off" ? (
            <div className="keep-white absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/75">
              <Camera className="size-10" aria-hidden="true" />
              <span className="text-sm font-bold">
                {isChinese
                  ? "摄像头画面将在此显示"
                  : "Your camera preview will appear here"}
              </span>
            </div>
          ) : (
            <div
              role="status"
              aria-live="assertive"
              aria-atomic="true"
              className="keep-white pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-transparent text-white"
            >
              {countdown !== null ? (
                <>
                  <strong className="text-7xl font-black drop-shadow-lg sm:text-8xl">
                    {countdown}
                  </strong>
                  <span className="rounded-full bg-black/50 px-4 py-1.5 text-sm font-bold">
                    {isChinese ? "准备好！" : "Get ready!"}
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-black/50 px-4 py-2 text-sm font-bold">
                  {isChinese ? "正在开启摄像头…" : "Opening camera…"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-center">
        {(error || saveState.error) && (
          <p role="alert" className="mt-3 text-sm text-[#a44a22]">
            {error || saveState.error}
          </p>
        )}
        {photo && photoDownloadUrl && saveState.status === "saved" && (
          <div className="mt-4 rounded-2xl border border-[#16865c]/20 bg-white p-4 text-center">
            <p className="text-sm font-bold text-[#17211c]">
              {isChinese
                ? "扫码下载带水印的队伍合影"
                : "Scan to download your watermarked team photo"}
            </p>
            <div className="mx-auto mt-3 w-full max-w-[300px] rounded-xl border border-black/5 bg-white p-2">
              <QRCodeSVG
                value={photoDownloadUrl}
                size={420}
                level="M"
                className="block h-auto w-full"
                bgColor="#ffffff"
                fgColor="#17211c"
              />
            </div>
            <a
              href={photoDownloadUrl}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#16865c] px-4 py-2 text-sm font-bold text-white hover:bg-[#116b49]"
            >
              <Download className="size-4" />{" "}
              {isChinese ? "在此设备下载" : "Download on this device"}
            </a>
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {saveState.status === "saved" ? (
            <p
              role="status"
              className="flex items-center gap-2 font-bold text-[#087653]"
            >
              <Check className="size-5" />{" "}
              {isChinese
                ? rank
                  ? "队伍合影已保存！"
                  : "照片已准备好下载！"
                : rank
                  ? "Team photo saved!"
                  : "Photo ready to download!"}
            </p>
          ) : photo ? (
            <>
              <Button
                variant="outline"
                disabled={saveState.status === "saving"}
                onClick={() => void openCamera()}
              >
                <RotateCcw className="size-4" /> {isChinese ? "重拍" : "Retake"}
              </Button>
              {saveState.status === "saving" ? (
                <p role="status" className="font-bold text-[#5b7068]">
                  {isChinese ? "正在保存照片…" : "Saving photo…"}
                </p>
              ) : saveState.status === "error" ? (
                <Button onClick={() => onSave(photo)}>
                  {isChinese ? "重试保存照片" : "Retry photo save"}
                </Button>
              ) : !rank ? (
                <p
                  role="status"
                  className="flex items-center gap-2 font-bold text-[#087653]"
                >
                  <Check className="size-5" />{" "}
                  {isChinese ? "照片已拍摄！" : "Photo captured!"}
                </p>
              ) : (
                <Button onClick={() => onSave(photo)}>
                  {isChinese ? "保存队伍合影" : "Save team photo"}
                </Button>
              )}
            </>
          ) : camera !== "off" ? (
            <Button variant="outline" onClick={stopCamera}>
              {isChinese ? "取消" : "Cancel"}
            </Button>
          ) : (
            <Button onClick={() => void openCamera()}>
              <Camera className="size-4" />{" "}
              {isChinese ? "开始拍照倒数" : "Start photo countdown"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
