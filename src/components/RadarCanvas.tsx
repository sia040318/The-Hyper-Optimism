import React, { useRef, useEffect } from 'react';
import { ThreatObstacle } from '../types/threats';
import { GazeZone } from '../types/gaze';
import { calculateAzimuth, calculateDistance, mapToProxyTarget } from '../utils/threatScenarios';

interface RadarCanvasProps {
  threats: ThreatObstacle[];
  currentGaze?: GazeZone;
  isSilenced?: boolean;
  onThreatMoved: (threat: ThreatObstacle) => void;
}

export const RadarCanvas: React.FC<RadarCanvasProps> = ({
  threats,
  currentGaze = 'CENTER',
  isSilenced = false,
  onThreatMoved
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const draggedThreatIdRef = useRef<string | null>(null);

  // Radar scale: meters to pixels
  const maxRangeMeters = 35.0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let pulsePhase = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = () => {
      resize();
      pulsePhase += 0.06;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      const scale = (Math.min(w, h) * 0.44) / maxRangeMeters;

      ctx.clearRect(0, 0, w, h);

      // 0. Draw Highway Lane Corridor (-8m to +8m)
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      [-8, -4, 0, 4, 8].forEach((lx) => {
        const xPx = cx + lx * scale;
        ctx.beginPath();
        if (lx === -4 || lx === 0 || lx === 4) {
          ctx.setLineDash([6, 6]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.moveTo(xPx, 10);
        ctx.lineTo(xPx, h - 10);
        ctx.stroke();
      });
      ctx.restore();

      // 1. Draw Range Rings (10m, 20m, 30m)
      const rings = [10, 20, 30];
      rings.forEach((r) => {
        const radius = r * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(161, 161, 170, 0.6)';
        ctx.font = '10px "Geist Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${r}m`, cx + 5, cy - radius + 12);
      });

      // 2. Active Driver Gaze Cone Visualization
      ctx.save();
      ctx.translate(cx, cy);
      let gazeAngle = -Math.PI / 2;
      if (currentGaze === 'LEFT_MIRROR') gazeAngle = Math.PI;
      else if (currentGaze === 'RIGHT_MIRROR') gazeAngle = 0;
      else if (currentGaze === 'REAR_MIRROR') gazeAngle = Math.PI / 2;

      const coneGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, 24 * scale);
      const isMirrorGaze = currentGaze !== 'CENTER' && currentGaze !== 'UNKNOWN';
      coneGrad.addColorStop(0, isMirrorGaze ? 'rgba(52, 211, 153, 0.22)' : 'rgba(56, 189, 248, 0.14)');
      coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 24 * scale, gazeAngle - 0.42, gazeAngle + 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 3. Mirror / Windshield Direction Labels
      ctx.font = '500 10px "Geist Mono", monospace';
      ctx.fillStyle = currentGaze === 'CENTER' ? '#38bdf8' : 'rgba(161, 161, 170, 0.65)';
      ctx.textAlign = 'center';
      ctx.fillText('FORWARD (0°)', cx, 18);

      ctx.fillStyle = currentGaze === 'REAR_MIRROR' ? '#34d399' : 'rgba(161, 161, 170, 0.65)';
      ctx.fillText('REAR-VIEW (180°)', cx, h - 32);

      ctx.textAlign = 'right';
      ctx.fillStyle = currentGaze === 'RIGHT_MIRROR' ? '#34d399' : 'rgba(161, 161, 170, 0.65)';
      ctx.fillText('RIGHT (+90°)', w - 14, cy - 6);

      ctx.textAlign = 'left';
      ctx.fillStyle = currentGaze === 'LEFT_MIRROR' ? '#34d399' : 'rgba(161, 161, 170, 0.65)';
      ctx.fillText('LEFT (-90°)', 14, cy - 6);

      // 4. Blind Spot Highlight Zones
      const drawBlindSpot = (isLeft: boolean) => {
        const xMin = (isLeft ? -6 : 2) * scale;
        const xMax = (isLeft ? -2 : 6) * scale;
        const yMin = -12 * scale;
        const yMax = 2 * scale;

        ctx.fillStyle = 'rgba(251, 191, 36, 0.04)';
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(cx + xMin, cy - yMax, xMax - xMin, yMax - yMin);
        ctx.strokeRect(cx + xMin, cy - yMax, xMax - xMin, yMax - yMin);
        ctx.setLineDash([]);
      };
      drawBlindSpot(true);
      drawBlindSpot(false);

      // 5. Ego Vehicle Silhouette
      ctx.save();
      ctx.translate(cx, cy);

      ctx.fillStyle = '#18181b';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-10, -20, 20, 40, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.roundRect(-7, -10, 14, 14, 3);
      ctx.fill();

      ctx.fillStyle = isMirrorGaze ? '#34d399' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, -3, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 6. Draw Threats & Acoustic Wavefronts
      threats.forEach((th, idx) => {
        const px = cx + th.x * scale;
        const py = cy - th.y * scale;

        const isPrimary = idx === 0;
        const isUrgent = th.distance < 14;
        const isMutedTarget = isPrimary && isSilenced;

        const coreColor = isMutedTarget
          ? '#34d399'
          : isUrgent
            ? '#f87171'
            : isPrimary
              ? '#fbbf24'
              : '#38bdf8';

        if (isPrimary && !isMutedTarget) {
          const waveRadius = 8 + ((pulsePhase * 12) % 24);
          const waveAlpha = Math.max(0, 1 - (waveRadius - 8) / 24);
          ctx.beginPath();
          ctx.arc(px, py, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = isUrgent
            ? `rgba(248, 113, 113, ${waveAlpha * 0.8})`
            : `rgba(251, 191, 36, ${waveAlpha * 0.8})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = isMutedTarget
          ? 'rgba(52, 211, 153, 0.35)'
          : isUrgent
            ? 'rgba(248, 113, 113, 0.35)'
            : 'rgba(56, 189, 248, 0.22)';
        ctx.lineWidth = isPrimary ? 1.5 : 1;
        ctx.stroke();

        ctx.save();
        ctx.translate(px, py);
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.roundRect(-8, -14, 16, 28, 4);
        ctx.fill();
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#fafafa';
        ctx.font = '500 10px "Inter", sans-serif';
        ctx.textAlign = px > cx ? 'left' : 'right';
        const labelOffset = px > cx ? 14 : -14;
        ctx.fillText(
          `${th.name} (${th.distance.toFixed(1)}m, ${th.azimuth > 0 ? '+' : ''}${th.azimuth.toFixed(0)}°)`,
          px + labelOffset,
          py + 3
        );
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    // Mouse Drag Interactions
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const scale = (Math.min(rect.width, rect.height) * 0.44) / maxRangeMeters;

      threats.forEach((th) => {
        const px = cx + th.x * scale;
        const py = cy - th.y * scale;
        const dist = Math.hypot(mx - px, my - py);
        if (dist <= 24) {
          isDraggingRef.current = true;
          draggedThreatIdRef.current = th.id;
        }
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !draggedThreatIdRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const scale = (Math.min(rect.width, rect.height) * 0.44) / maxRangeMeters;

      const newX = (mx - cx) / scale;
      const newY = -(my - cy) / scale;

      const dragged = threats.find((t) => t.id === draggedThreatIdRef.current);
      if (dragged) {
        const az = calculateAzimuth(newX, newY);
        const dist = calculateDistance(newX, newY);
        const proxy = mapToProxyTarget(newX, newY, az);

        onThreatMoved({
          ...dragged,
          x: parseFloat(newX.toFixed(2)),
          y: parseFloat(newY.toFixed(2)),
          azimuth: parseFloat(az.toFixed(1)),
          distance: parseFloat(dist.toFixed(1)),
          proxyTarget: proxy
        });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      draggedThreatIdRef.current = null;
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [threats, currentGaze, isSilenced, onThreatMoved]);

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab rounded-[10px] border border-border bg-background active:cursor-grabbing"
      />
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card/90 px-3.5 py-1 font-mono text-[10px] whitespace-nowrap text-muted-foreground backdrop-blur-sm">
        360° Spatial Radar • Drag any vehicle to test HRTF coordinates
      </div>
    </div>
  );
};
