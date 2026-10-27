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
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.09)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${r}m`, cx + 5, cy - radius + 12);
      });

      // 2. Active Driver Gaze Cone Visualization
      ctx.save();
      ctx.translate(cx, cy);
      let gazeAngle = -Math.PI / 2; // Forward (-Y on canvas)
      if (currentGaze === 'LEFT_MIRROR') gazeAngle = Math.PI;
      else if (currentGaze === 'RIGHT_MIRROR') gazeAngle = 0;
      else if (currentGaze === 'REAR_MIRROR') gazeAngle = Math.PI / 2;

      const coneGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, 24 * scale);
      const isMirrorGaze = currentGaze !== 'CENTER' && currentGaze !== 'UNKNOWN';
      coneGrad.addColorStop(0, isMirrorGaze ? 'rgba(16, 185, 129, 0.24)' : 'rgba(0, 240, 255, 0.14)');
      coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 24 * scale, gazeAngle - 0.42, gazeAngle + 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 3. Mirror / Windshield Direction Labels
      ctx.font = '600 10px "Inter", sans-serif';
      ctx.fillStyle = currentGaze === 'CENTER' ? '#00f0ff' : 'rgba(148, 163, 184, 0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('▲ FORWARD WINDSHIELD (0°)', cx, 18);

      ctx.fillStyle = currentGaze === 'REAR_MIRROR' ? '#10b981' : 'rgba(148, 163, 184, 0.6)';
      ctx.fillText('▼ REAR-VIEW MIRROR (180°)', cx, h - 32);

      ctx.textAlign = 'right';
      ctx.fillStyle = currentGaze === 'RIGHT_MIRROR' ? '#10b981' : 'rgba(148, 163, 184, 0.6)';
      ctx.fillText('RIGHT MIRROR (+90°) ▶', w - 14, cy - 6);

      ctx.textAlign = 'left';
      ctx.fillStyle = currentGaze === 'LEFT_MIRROR' ? '#10b981' : 'rgba(148, 163, 184, 0.6)';
      ctx.fillText('◀ LEFT MIRROR (-90°)', 14, cy - 6);

      // 4. Blind Spot Highlight Zones
      const drawBlindSpot = (isLeft: boolean) => {
        const xMin = (isLeft ? -6 : 2) * scale;
        const xMax = (isLeft ? -2 : 6) * scale;
        const yMin = -12 * scale;
        const yMax = 2 * scale;

        ctx.fillStyle = 'rgba(245, 158, 11, 0.05)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
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

      // Vehicle body
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-10, -20, 20, 40, 5);
      ctx.fill();
      ctx.stroke();

      // Cabin windshield
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(-7, -10, 14, 14, 3);
      ctx.fill();

      // Driver head indicator dot
      ctx.fillStyle = isMirrorGaze ? '#10b981' : '#00f0ff';
      ctx.beginPath();
      ctx.arc(0, -3, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 6. Draw Threats & Acoustic Wavefronts
      threats.forEach((th, idx) => {
        const px = cx + th.x * scale;
        const py = cy - th.y * scale; // +Y is forward (up on screen)

        const isPrimary = idx === 0;
        const isUrgent = th.distance < 14;
        const isMutedTarget = isPrimary && isSilenced;

        const coreColor = isMutedTarget
          ? '#10b981'
          : isUrgent
          ? '#f43f5e'
          : isPrimary
          ? '#f59e0b'
          : '#38bdf8';

        // Animated acoustic pulse ring on primary threat
        if (isPrimary && !isMutedTarget) {
          const waveRadius = 8 + ((pulsePhase * 12) % 24);
          const waveAlpha = Math.max(0, 1 - (waveRadius - 8) / 24);
          ctx.beginPath();
          ctx.arc(px, py, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = isUrgent
            ? `rgba(244, 63, 94, ${waveAlpha * 0.8})`
            : `rgba(245, 158, 11, ${waveAlpha * 0.8})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Vector line to ego vehicle
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = isMutedTarget
          ? 'rgba(16, 185, 129, 0.35)'
          : isUrgent
          ? 'rgba(244, 63, 94, 0.35)'
          : 'rgba(0, 240, 255, 0.2)';
        ctx.lineWidth = isPrimary ? 1.8 : 1;
        ctx.stroke();

        // Vehicle / Threat representation
        ctx.save();
        ctx.translate(px, py);
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.roundRect(-8, -14, 16, 28, 4);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        // Threat Telemetry Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 10px "Inter", sans-serif';
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
    <div className="radar-canvas-wrapper">
      <canvas ref={canvasRef} className="radar-canvas" />
      <div className="radar-tip-bar">
        📡 Live 360° Spatial Audio & LiDAR Bird's-Eye View • Drag any vehicle to test custom 3D HRTF positions
      </div>
    </div>
  );
};
