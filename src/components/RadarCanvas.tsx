import React, { useRef, useEffect } from 'react';
import { ThreatObstacle } from '../types/threats';
import { calculateAzimuth, calculateDistance, mapToProxyTarget } from '../utils/threatScenarios';

interface RadarCanvasProps {
  threats: ThreatObstacle[];
  onThreatMoved: (threat: ThreatObstacle) => void;
}

export const RadarCanvas: React.FC<RadarCanvasProps> = ({ threats, onThreatMoved }) => {
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

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    const render = () => {
      resize();
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const scale = (Math.min(w, h) * 0.44) / maxRangeMeters;

      ctx.clearRect(0, 0, w, h);

      // 1. Draw Range Rings
      const rings = [10, 20, 30];
      rings.forEach((r) => {
        const radius = r * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ring distance label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`${r}m`, cx + 6, cy - radius + 12);
      });

      // 2. Azimuth Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx, 15);
      ctx.lineTo(cx, h - 15);
      ctx.moveTo(15, cy);
      ctx.lineTo(w - 15, cy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();

      // Mirror / Windshield direction labels
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('FORWARD WINDSHIELD (0°)', cx, 24);
      ctx.fillText('REAR-VIEW MIRROR (180°)', cx, h - 14);

      ctx.textAlign = 'left';
      ctx.fillText('RIGHT MIRROR (+90°)', w - 130, cy - 6);
      ctx.textAlign = 'right';
      ctx.fillText('LEFT MIRROR (-90°)', 130, cy - 6);

      // 3. Blind Spot Highlight Zones
      const drawBlindSpot = (isLeft: boolean) => {
        const xMin = (isLeft ? -6 : 2) * scale;
        const xMax = (isLeft ? -2 : 6) * scale;
        const yMin = -7 * scale;
        const yMax = 2 * scale;

        ctx.fillStyle = 'rgba(245, 158, 11, 0.04)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(cx + xMin, cy - yMax, xMax - xMin, yMax - yMin);
        ctx.strokeRect(cx + xMin, cy - yMax, xMax - xMin, yMax - yMin);
        ctx.setLineDash([]);
      };
      drawBlindSpot(true);
      drawBlindSpot(false);

      // 4. Ego Vehicle Silhouette
      ctx.save();
      ctx.translate(cx, cy);

      // Headlight beams
      const beamGrad = ctx.createRadialGradient(0, -18, 5, 0, -60, 60);
      beamGrad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
      beamGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-10, -18);
      ctx.lineTo(-45, -80);
      ctx.lineTo(45, -80);
      ctx.lineTo(10, -18);
      ctx.closePath();
      ctx.fill();

      // Vehicle body
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-12, -22, 24, 44, 6);
      ctx.fill();
      ctx.stroke();

      // Cabin windshield
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(-9, -12, 18, 16, 3);
      ctx.fill();

      // Driver icon dot
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(-2, -4, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 5. Draw Threats
      threats.forEach((th) => {
        const px = cx + th.x * scale;
        const py = cy - th.y * scale; // Y inverted in screen coords

        // Threat halo
        const isUrgent = th.distance < 12;
        const glowColor = isUrgent ? 'rgba(244, 63, 94, 0.5)' : 'rgba(0, 240, 255, 0.4)';
        const coreColor = isUrgent ? '#f43f5e' : '#00f0ff';

        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = coreColor;
        ctx.fill();

        // Target connector line to ego car
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = isUrgent ? 'rgba(244, 63, 94, 0.25)' : 'rgba(0, 240, 255, 0.15)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Threat Label
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${th.name} (${th.distance.toFixed(1)}m)`, px + 12, py + 4);
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    // Mouse Drag Interactions
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const scale = (Math.min(canvas.width, canvas.height) * 0.44) / maxRangeMeters;

      threats.forEach((th) => {
        const px = cx + th.x * scale;
        const py = cy - th.y * scale;
        const dist = Math.hypot(mx - px, my - py);
        if (dist <= 22) {
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
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const scale = (Math.min(canvas.width, canvas.height) * 0.44) / maxRangeMeters;

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
  }, [threats, onThreatMoved]);

  return (
    <div className="radar-canvas-wrapper">
      <canvas ref={canvasRef} className="radar-canvas" />
      <div className="radar-tip-bar">
        💡 Click and drag any vehicle or threat on the radar to move sound in 3D around the car
      </div>
    </div>
  );
};
