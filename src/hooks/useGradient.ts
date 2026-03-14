import { useEffect, useRef } from "react";

interface GradientConfig {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useGradient({ canvasRef }: GradientConfig) {
  const frameRef = useRef<number>(0);

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

      // Base fill
      ctx.fillStyle = "#F0EEFF";
      ctx.fillRect(0, 0, w, h);

      // Three radial gradients with different periods
      const blobs = [
        {
          period: 7,
          hue: 240,
          x: 0.3 + 0.2 * Math.sin(t / 7),
          y: 0.3 + 0.2 * Math.cos(t / 9),
        },
        {
          period: 11,
          hue: 260,
          x: 0.7 + 0.15 * Math.sin(t / 11),
          y: 0.6 + 0.2 * Math.cos(t / 7),
        },
        {
          period: 13,
          hue: 220,
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
          `hsla(${hue}, 80%, 75%, 0.4)`,
        );
        gradient.addColorStop(1, `hsla(${hue}, 80%, 75%, 0)`);

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
