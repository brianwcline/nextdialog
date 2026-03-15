import { useEffect, useRef } from "react";
import type { SessionStatus } from "../lib/types";

interface GradientConfig {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  sessionStatuses?: SessionStatus[];
}

function computeMoodHues(statuses: SessionStatus[]): [number, number, number] {
  if (statuses.length === 0) return [330, 20, 280]; // warm pink/peach/lavender

  const hasError = statuses.some((s) => s === "error");
  const hasWaiting = statuses.some((s) => s === "waiting");
  const workingCount = statuses.filter((s) => s === "working").length;
  const allIdle = statuses.every(
    (s) => s === "idle" || s === "stopped",
  );

  if (hasError) {
    // Warm red shift
    return [0, 20, 340];
  }
  if (hasWaiting) {
    // Amber warmth
    return [30, 45, 15];
  }
  if (workingCount > statuses.length / 2) {
    // Energetic purple/indigo
    return [270, 290, 250];
  }
  if (allIdle) {
    // Warm pink/coral/lavender
    return [340, 10, 270];
  }
  // Mixed/default — warm pink/peach/lavender
  return [330, 20, 280];
}

export function useGradient({ canvasRef, sessionStatuses = [] }: GradientConfig) {
  const frameRef = useRef<number>(0);
  const targetHuesRef = useRef<[number, number, number]>([330, 20, 280]);
  const currentHuesRef = useRef<[number, number, number]>([330, 20, 280]);

  // Update target hues when statuses change
  useEffect(() => {
    targetHuesRef.current = computeMoodHues(sessionStatuses);
  }, [sessionStatuses.join(",")]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const startTime = performance.now();

    const animate = (now: number) => {
      const t = (now - startTime) / 1000;
      const w = canvas.width;
      const h = canvas.height;

      // Lerp current hues toward target (smooth 2s transition)
      const lerpRate = 0.02;
      for (let i = 0; i < 3; i++) {
        const diff = targetHuesRef.current[i] - currentHuesRef.current[i];
        currentHuesRef.current[i] += diff * lerpRate;
      }

      // Base fill — warm cream
      ctx.fillStyle = "#FBF5F3";
      ctx.fillRect(0, 0, w, h);

      // Three radial gradients with different periods
      const blobs = [
        {
          period: 7,
          hue: currentHuesRef.current[0],
          x: 0.3 + 0.2 * Math.sin(t / 7),
          y: 0.3 + 0.2 * Math.cos(t / 9),
        },
        {
          period: 11,
          hue: currentHuesRef.current[1],
          x: 0.7 + 0.15 * Math.sin(t / 11),
          y: 0.6 + 0.2 * Math.cos(t / 7),
        },
        {
          period: 13,
          hue: currentHuesRef.current[2],
          x: 0.5 + 0.25 * Math.sin(t / 13),
          y: 0.4 + 0.15 * Math.cos(t / 11),
        },
      ];

      for (const blob of blobs) {
        const hue = blob.hue + 20 * Math.sin(t / blob.period);
        const cx = blob.x * w;
        const cy = blob.y * h;
        const radius = Math.max(w, h) * 0.5;

        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(
          0,
          `hsla(${hue}, 75%, 72%, 0.45)`,
        );
        gradient.addColorStop(1, `hsla(${hue}, 75%, 72%, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef]);
}
